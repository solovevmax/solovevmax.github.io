/* Recipes per herb + growth-stage logic.
 *
 * Each recipe: { id, title, blurb, ingredients: [{ id, text }], method: [strings] }
 * Add new recipes by appending to RECIPES[herbId].
 *
 * Recipe-of-the-Day picks deterministically from the herb's recipe array
 * using day-of-year, so the choice rotates daily but is stable within a day.
 */
(function (root) {

  const RECIPES = {
    basil: [
      {
        id: 'basil-pesto',
        title: 'Classic Basil Pesto',
        blurb: 'A bright, fragrant pesto that turns a handful of basil into the heart of any meal — tossed through pasta, spooned over grilled veg, or stirred into soup.',
        ingredients: [
          { id: 'basil-leaves',  text: '60 g fresh basil leaves (packed)' },
          { id: 'pine-nuts',     text: '30 g pine nuts, lightly toasted' },
          { id: 'parmesan',      text: '40 g Parmesan, finely grated' },
          { id: 'garlic',        text: '1 small garlic clove' },
          { id: 'olive-oil',     text: '120 ml extra-virgin olive oil' },
          { id: 'lemon',         text: '½ lemon, juice only' },
          { id: 'salt',          text: 'Sea salt and black pepper to taste' },
        ],
        method: [
          'Toast the pine nuts in a dry pan over low heat until golden. Cool.',
          'Blitz garlic, pine nuts and a pinch of salt in a food processor.',
          'Add the basil and pulse — short bursts, keep some texture.',
          'Stream in the olive oil with the motor running until just combined.',
          'Stir in the Parmesan and lemon juice. Season and use within 3 days.',
        ],
      },
      {
        id: 'basil-tomato-bruschetta',
        title: 'Tomato & Basil Bruschetta',
        blurb: 'Summer on toast. Ripe tomatoes, torn basil, a glug of good oil — done in ten minutes.',
        ingredients: [
          { id: 'sourdough',     text: '4 thick slices of sourdough' },
          { id: 'tomatoes',      text: '400 g ripe tomatoes, diced' },
          { id: 'basil',         text: 'A small handful of basil leaves' },
          { id: 'garlic-clove',  text: '1 garlic clove, halved' },
          { id: 'olive-oil',     text: 'Olive oil, for drizzling' },
          { id: 'balsamic',      text: '1 tsp aged balsamic (optional)' },
          { id: 'salt',          text: 'Flaky sea salt' },
        ],
        method: [
          'Toss tomatoes with a pinch of salt; rest 5 min so juices come out.',
          'Toast the sourdough until crisp on the outside, still soft inside.',
          'Rub each slice with the cut side of the garlic clove.',
          'Pile on the tomatoes, tear over basil, drizzle oil and balsamic.',
          'Finish with flaky salt and eat immediately.',
        ],
      },
      {
        id: 'basil-strawberry-salad',
        title: 'Basil & Strawberry Salad',
        blurb: 'An unexpectedly grown-up combination — sweet, peppery, summery.',
        ingredients: [
          { id: 'strawberries',  text: '300 g strawberries, hulled and quartered' },
          { id: 'basil-leaves',  text: 'A generous handful of basil leaves' },
          { id: 'mozzarella',    text: '125 g buffalo mozzarella, torn' },
          { id: 'olive-oil',     text: '1 tbsp olive oil' },
          { id: 'balsamic',      text: '1 tsp balsamic vinegar' },
          { id: 'black-pepper',  text: 'A generous grind of black pepper' },
        ],
        method: [
          'Combine strawberries, torn basil and mozzarella on a platter.',
          'Whisk oil and balsamic and drizzle over.',
          'Crack over plenty of black pepper. Serve immediately.',
        ],
      },
    ],

    parsley: [
      {
        id: 'tabbouleh',
        title: 'Parsley Tabbouleh',
        blurb: 'Parsley is the star here, not a garnish. Bright, herby, refreshing.',
        ingredients: [
          { id: 'parsley',       text: '2 large bunches flat-leaf parsley, finely chopped' },
          { id: 'bulgur',        text: '60 g fine bulgur wheat, soaked' },
          { id: 'tomatoes',      text: '200 g tomatoes, finely diced' },
          { id: 'spring-onion',  text: '4 spring onions, finely sliced' },
          { id: 'mint',          text: 'A small handful of mint, chopped' },
          { id: 'lemon',         text: '2 lemons, juice only' },
          { id: 'olive-oil',     text: '4 tbsp extra-virgin olive oil' },
          { id: 'salt',          text: 'Salt to taste' },
        ],
        method: [
          'Soak bulgur in cold water for 20 min, then drain very well.',
          'Combine parsley, mint, tomatoes, spring onion and drained bulgur.',
          'Whisk lemon juice, olive oil and salt. Dress salad. Taste and adjust.',
          'Rest 10 min before serving so flavours mingle.',
        ],
      },
      {
        id: 'salsa-verde',
        title: 'Quick Salsa Verde',
        blurb: 'A punchy green sauce — works on fish, lamb, eggs, anything roasted.',
        ingredients: [
          { id: 'parsley',       text: 'Large bunch flat-leaf parsley' },
          { id: 'capers',        text: '1 tbsp capers, drained' },
          { id: 'anchovies',     text: '2 anchovy fillets (optional)' },
          { id: 'garlic',        text: '1 small garlic clove' },
          { id: 'lemon',         text: '½ lemon, juice only' },
          { id: 'olive-oil',     text: '6 tbsp olive oil' },
          { id: 'mustard',       text: '1 tsp Dijon mustard' },
        ],
        method: [
          'Finely chop parsley, capers, anchovies and garlic together.',
          'Stir in mustard, lemon juice and olive oil.',
          'Season and let sit 5 min. Spoon over anything that needs lifting.',
        ],
      },
      {
        id: 'parsley-egg-bake',
        title: 'Parsley & Feta Egg Bake',
        blurb: 'Eggs baked with crumbled feta and a snow of parsley. A perfect Sunday breakfast.',
        ingredients: [
          { id: 'eggs',          text: '6 eggs' },
          { id: 'feta',          text: '100 g feta, crumbled' },
          { id: 'parsley',       text: 'Large handful parsley, chopped' },
          { id: 'spring-onion',  text: '2 spring onions, sliced' },
          { id: 'olive-oil',     text: '1 tbsp olive oil' },
          { id: 'pepper',        text: 'Black pepper to taste' },
        ],
        method: [
          'Heat oven to 200 °C / 180 °C fan.',
          'Whisk eggs with most of the parsley, spring onion and pepper.',
          'Pour into an oiled dish, scatter feta on top.',
          'Bake 12–15 min until just set. Scatter remaining parsley to serve.',
        ],
      },
    ],

    thyme: [
      {
        id: 'thyme-roast-potatoes',
        title: 'Thyme & Garlic Roast Potatoes',
        blurb: 'Crisp, golden, fragrant — thyme is what makes them.',
        ingredients: [
          { id: 'potatoes',      text: '1 kg floury potatoes (Maris Piper)' },
          { id: 'thyme',         text: 'A generous handful of thyme sprigs' },
          { id: 'garlic-bulb',   text: '1 head of garlic, cloves separated, skin on' },
          { id: 'olive-oil',     text: '4 tbsp olive oil or duck fat' },
          { id: 'salt',          text: 'Flaky sea salt' },
        ],
        method: [
          'Heat oven to 220 °C / 200 °C fan. Peel and halve the potatoes.',
          'Parboil 8 min in salted water. Drain and shake to roughen edges.',
          'Toss with oil, garlic cloves and thyme on a hot tray.',
          'Roast 40–45 min, turning once, until deep gold and crisp.',
          'Salt heavily right out of the oven.',
        ],
      },
      {
        id: 'thyme-mushrooms',
        title: 'Buttery Thyme Mushrooms',
        blurb: 'A few minutes in a hot pan with butter, garlic and thyme — instant side dish.',
        ingredients: [
          { id: 'mushrooms',     text: '400 g chestnut mushrooms, halved' },
          { id: 'butter',        text: '40 g unsalted butter' },
          { id: 'garlic',        text: '2 garlic cloves, smashed' },
          { id: 'thyme',         text: '6 thyme sprigs' },
          { id: 'lemon',         text: '½ lemon, juice only' },
        ],
        method: [
          'Heat a wide pan very hot. Melt the butter.',
          'Add mushrooms cut side down. Don\'t move them — let them brown.',
          'Toss, add garlic and thyme, cook 2 min more.',
          'Squeeze over lemon, season and serve immediately.',
        ],
      },
      {
        id: 'thyme-lentil-soup',
        title: 'Lentil & Thyme Soup',
        blurb: 'Quiet, warming, and miraculous given how little it asks of you.',
        ingredients: [
          { id: 'lentils',       text: '200 g red lentils, rinsed' },
          { id: 'onion',         text: '1 onion, diced' },
          { id: 'carrot',        text: '2 carrots, diced' },
          { id: 'thyme',         text: '4 thyme sprigs, leaves picked' },
          { id: 'stock',         text: '1 l vegetable stock' },
          { id: 'olive-oil',     text: '2 tbsp olive oil' },
          { id: 'lemon',         text: '½ lemon, juice only' },
        ],
        method: [
          'Sweat onion and carrot in oil for 8 min until soft.',
          'Add thyme, lentils and stock. Simmer 25 min until lentils collapse.',
          'Blend roughly (or leave chunky). Finish with lemon and salt.',
        ],
      },
    ],

    mint: [
      {
        id: 'minty-pea-soup',
        title: 'Minty Pea Soup',
        blurb: 'Sweet peas + cold mint = a 15-minute bowl that tastes like spring.',
        ingredients: [
          { id: 'peas',          text: '500 g frozen peas' },
          { id: 'mint',          text: 'A large handful fresh mint' },
          { id: 'stock',         text: '750 ml vegetable stock' },
          { id: 'shallot',       text: '1 shallot, finely diced' },
          { id: 'butter',        text: '30 g butter' },
          { id: 'creme-fraiche', text: '2 tbsp crème fraîche, to serve' },
        ],
        method: [
          'Sweat shallot in butter until soft, 5 min.',
          'Add peas and stock; simmer 5 min until peas are bright.',
          'Off the heat, add mint. Blend until smooth.',
          'Season and finish each bowl with a swirl of crème fraîche.',
        ],
      },
      {
        id: 'mint-yogurt-dip',
        title: 'Mint & Yoghurt Dip',
        blurb: 'Cooling, fresh, perfect with anything spicy or fried.',
        ingredients: [
          { id: 'yoghurt',       text: '250 g thick Greek yoghurt' },
          { id: 'mint',          text: 'A small bunch mint, finely chopped' },
          { id: 'cucumber',      text: '½ cucumber, deseeded and grated' },
          { id: 'garlic',        text: '1 small garlic clove, microplaned' },
          { id: 'lemon',         text: '½ lemon, juice only' },
          { id: 'salt',          text: 'Sea salt to taste' },
        ],
        method: [
          'Squeeze the grated cucumber dry with your hands.',
          'Mix everything in a bowl. Taste; adjust salt and lemon.',
          'Chill 10 min before serving so the flavours come together.',
        ],
      },
      {
        id: 'mint-chocolate-pots',
        title: 'Mint Chocolate Pots',
        blurb: 'A grown-up after-eight in dessert form — infuse cream with fresh mint.',
        ingredients: [
          { id: 'dark-chocolate',text: '150 g dark chocolate (70%), chopped' },
          { id: 'cream',         text: '300 ml double cream' },
          { id: 'mint',          text: 'A small bunch mint leaves' },
          { id: 'sugar',         text: '1 tbsp caster sugar' },
          { id: 'pinch-salt',    text: 'Tiny pinch sea salt' },
        ],
        method: [
          'Warm cream with mint and sugar until just steaming. Off heat 10 min.',
          'Strain out mint. Pour hot cream over chopped chocolate.',
          'Wait 2 min, then stir gently until glossy and smooth.',
          'Divide into 4 small pots and chill 2 hr. Eat cold.',
        ],
      },
    ],
  };

  function dayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    return Math.floor(diff / 86_400_000);
  }

  function recipeOfTheDay(herbId, date = new Date()) {
    const list = RECIPES[herbId] || RECIPES.basil;
    const idx = dayOfYear(date) % list.length;
    return list[idx];
  }

  // Growth stages + harvest readiness from planted date + plant source.
  //
  // plantSource:
  //   'seeds'  - default; uses plant.grow_time_days thresholds.
  //   'mature' - shop-bought / fully grown; harvest-ready from day 1.
  //              The "Day X" counter now measures days since acquisition.
  function growthStage(plantedIso, plant, plantSource) {
    if (!plantedIso) {
      return {
        days: 0,
        stage: 'Not planted',
        recommendation: 'Set a planted date in Settings to start tracking.',
        harvestReady: false,
        source: plantSource || 'seeds',
        progressPct: 0,
        dayLabel: 'Day',
      };
    }
    const plantedDate = new Date(plantedIso);
    const days = Math.max(0, Math.floor((Date.now() - plantedDate.getTime()) / 86_400_000));
    const source = plantSource === 'mature' ? 'mature' : 'seeds';

    if (source === 'mature') {
      // Shop-bought plants are already mature — harvest-ready from day 1.
      return {
        days,
        stage: 'Ready to harvest',
        recommendation: 'Shop-bought and already mature — pick a few outer or top leaves at a time and use them straight away. Regular light picking keeps the plant productive.',
        harvestReady: true,
        source,
        progressPct: 100,
        dayLabel: 'Day',
      };
    }

    const g = plant.grow_time_days;
    let stage, recommendation, harvestReady = false;
    if (days < g.seedling) {
      stage = 'Seedling';
      recommendation = 'Too early to harvest — keep the seedling warm and gently moist.';
    } else if (days < g.vegetative) {
      stage = 'Vegetative';
      recommendation = 'Too early to harvest — let it build leaves and roots first.';
    } else if (days < g.mature) {
      stage = 'Maturing';
      recommendation = 'Light harvesting OK — pinch off a few top leaves to encourage branching.';
    } else {
      stage = 'Harvest-ready';
      harvestReady = true;
      recommendation = 'Ready to harvest. Regular picking will keep the plant productive.';
    }
    const progressPct = Math.max(0, Math.min(100, (days / g.harvest) * 100));
    return { days, stage, recommendation, harvestReady, source, progressPct, dayLabel: 'Day' };
  }

  root.SproutRecipes = { RECIPES, recipeOfTheDay, growthStage };
})(window);
