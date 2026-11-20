/**
 * Blueprint-Engine: wandelt einen natürlichsprachigen Spielwunsch in strukturierte
 * Spieldaten um (Welt, Inseln, Gebäude, Pets, Shop, Quests, Gegner, NPCs, Level).
 *
 * Zwei Wege erzeugen einen Blueprint:
 *  1. createBlueprint()  - deterministische Vorlagen-Engine (kein API-Key nötig)
 *  2. normalizeBlueprint() - validiert die Antwort eines LLM gegen dasselbe Schema
 *
 * Der Compiler (server/compiler.js) macht daraus echte Studio-Aktionen + Luau-Code.
 */

export const RARITIES = [
  { id: 'common', label: 'Häufig', weight: 50, multiplier: 1, color: '#b8c2cc' },
  { id: 'uncommon', label: 'Ungewöhnlich', weight: 26, multiplier: 1.7, color: '#5fd35f' },
  { id: 'rare', label: 'Selten', weight: 14, multiplier: 3, color: '#4aa8ff' },
  { id: 'epic', label: 'Episch', weight: 7, multiplier: 5.5, color: '#b46bff' },
  { id: 'legendary', label: 'Legendär', weight: 3, multiplier: 12, color: '#ffb43a' },
];

export const THEMES = {
  anime: {
    id: 'anime',
    label: 'Anime-Simulator',
    sky: '#8fd4ff',
    ground: '#67c96a',
    water: '#2f7fd0',
    palette: ['#ff77aa', '#ffd166', '#7ae7ff', '#c084fc', '#ffa07a'],
  },
  fantasy: {
    id: 'fantasy',
    label: 'Fantasy-Abenteuer',
    sky: '#a9c8ff',
    ground: '#5fa85f',
    water: '#2c6fb8',
    palette: ['#7bd389', '#c9a227', '#8ab6ff', '#d98cff', '#ffb27a'],
  },
  horror: {
    id: 'horror',
    label: 'Horror',
    sky: '#2a2433',
    ground: '#3b3a3f',
    water: '#1d2b3a',
    palette: ['#8b1e2d', '#4b3f72', '#2f4b4b', '#a89b7c', '#c94f4f'],
  },
  scifi: {
    id: 'scifi',
    label: 'Sci-Fi',
    sky: '#0d1b2a',
    ground: '#3a4a63',
    water: '#123a5c',
    palette: ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24'],
  },
  tycoon: {
    id: 'tycoon',
    label: 'Tycoon',
    sky: '#9ec5ff',
    ground: '#8a8f98',
    water: '#3a6ea5',
    palette: ['#ffb703', '#8ecae6', '#fb8500', '#219ebc', '#adb5bd'],
  },
  obby: {
    id: 'obby',
    label: 'Obby',
    sky: '#bfe6ff',
    ground: '#d9d9d9',
    water: '#4aa8ff',
    palette: ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a06cd5', '#ff9f1c'],
  },
  default: {
    id: 'default',
    label: 'Roblox-Spiel',
    sky: '#8fd4ff',
    ground: '#6fcf6f',
    water: '#2f7fd0',
    palette: ['#4aa8ff', '#ffd166', '#ff77aa', '#7ae7ff', '#c084fc'],
  },
};

const PET_POOL = {
  common: ['Kätzchen', 'Welpe', 'Küken', 'Frosch', 'Igel', 'Biber', 'Maus', 'Fuchs', 'Eule', 'Häschen'],
  uncommon: ['Feuerfuchs', 'Wasserwicht', 'Windgeist', 'Steinbär', 'Blattfalter', 'Eiswolf', 'Sandkatze', 'Nebelkauz'],
  rare: ['Donnerdrache', 'Kristallfuchs', 'Schattenkatze', 'Sturmgreif', 'Mondhase', 'Rubinphönix'],
  epic: ['Himmelsdrache', 'Abgrundlöwe', 'Zeitgeist', 'Nova-Einhorn', 'Kaisergreif'],
  legendary: ['Götterdrache', 'Sternenkaiser', 'Ewiger Phönix', 'Dimensionskatze', 'Weltenwandler'],
};

const ITEM_POOL = [
  'Verstärkter Köder', 'Glücksbringer', 'Turbo-Trunk', 'XP-Booster', 'Mega-Köder',
  'Schatzsack', 'Goldener Schlüssel', 'Zeitkristall', 'Kraftamulett', 'Doppel-Münzen',
  'Schnellflügel', 'Kampfhandschuh', 'Energie-Riegel', 'Sammler-Rucksack',
];

const ENEMY_POOL = [
  'Schleimmonster', 'Waldwächter', 'Steingolem', 'Sandräuber', 'Eisgeist', 'Feuerwicht',
  'Schattenwolf', 'Kristallspinne', 'Sumpfschrecke', 'Blitzsprite', 'Knochengänger', 'Rankenkriecher',
];

const BOSS_POOL = ['Inselkönig', 'Schattenfürst', 'Uralter Drache', 'Weltenverschlinger', 'Sturmtyrann'];

const NPC_POOL = [
  'Meister Kenji', 'Händlerin Mira', 'Questgeber Taro', 'Schmied Bolin', 'Forscherin Yuna',
  'Kapitän Riku', 'Heilerin Sana', 'Trainer Goro', 'Kundschafter Leo', 'Alchemist Nia',
];

const ISLAND_POOL = [
  'Anfängerinsel', 'Blütenbucht', 'Kristallklippe', 'Drachenfelsen', 'Nebelwald',
  'Sonnenstrand', 'Eishöhle', 'Vulkaninsel', 'Himmelsplateau', 'Geisterhafen',
];

const BUILDING_POOL = ['Pet-Shop', 'Quest-Halle', 'Waffenladen', 'Trainingsplatz', 'Portal', 'Lagerhaus', 'Rathaus', 'Heilbrunnen'];

const NUMBER_WORDS = {
  ein: 1, eine: 1, einen: 1, einem: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6,
  sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12, fünfzehn: 15,
  zwanzig: 20, dreißig: 30, dreissig: 30, hundert: 100,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, twenty: 20,
};

/* ------------------------------- Helfer -------------------------------- */

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampInt = (value, min, max, fallback) => {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const round1 = (value) => Math.round(value * 10) / 10;

function nameAt(pool, index) {
  const base = pool[index % pool.length];
  const cycle = Math.floor(index / pool.length);
  if (cycle === 0) return base;
  const suffix = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][Math.min(cycle - 1, 8)];
  return `${base} ${suffix}`;
}

/** Findet Zahlen wie "12 Pets", "zehn neue Pets", "3 Inseln" im Prompt. */
function countFrom(prompt, patterns, fallback, max = 60) {
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const raw = match[1];
    if (/^\d+$/.test(raw)) return clampInt(raw, 1, max, fallback);
    const word = NUMBER_WORDS[raw];
    if (word) return clampInt(word, 1, max, fallback);
  }
  return fallback;
}

function detectTheme(prompt) {
  const rules = [
    [/anime|simulator|pets?\b|insel|insel|waifu/, 'anime'],
    [/horror|grusel|spuk|zombie|düster|dunkel/, 'horror'],
    [/sci-?fi|weltraum|space|roboter|cyber|neon/, 'scifi'],
    [/tycoon|fabrik|wirtschaft|aufbau|geld verdienen/, 'tycoon'],
    [/obby|parkour|hindernis|jump/, 'obby'],
    [/fantasy|magie|ritter|drache|zauber|mittelalter/, 'fantasy'],
  ];
  for (const [pattern, id] of rules) {
    if (pattern.test(prompt)) return THEMES[id];
  }
  return THEMES.default;
}

function detectGenre(prompt, theme) {
  if (/simulator/.test(prompt)) return 'simulator';
  if (/tycoon/.test(prompt)) return 'tycoon';
  if (/obby|parkour/.test(prompt)) return 'obby';
  if (/horror/.test(prompt)) return 'horror';
  if (/pvp|battle royale|kampf/.test(prompt)) return 'pvp';
  if (/tower defense|verteidigung/.test(prompt)) return 'tower-defense';
  return theme.id === 'default' ? 'adventure' : theme.id;
}

function titleFromPrompt(prompt, theme) {
  const cleaned = prompt
    .replace(/^(erstelle?|baue?|mach(e)?|generiere?)\s+(mir\s+)?(einen|eine|ein)\s+/i, '')
    .replace(/^(erstelle?|baue?|mach(e)?|generiere?)\s+(mir\s+)?/i, '')
    .trim();
  const firstSentence = cleaned.split(/[.\n!?]/)[0].trim();
  if (firstSentence.length >= 4) {
    const short = firstSentence.length > 52 ? `${firstSentence.slice(0, 52).trim()}…` : firstSentence;
    return short.charAt(0).toUpperCase() + short.slice(1);
  }
  return theme.label;
}

function raritySequence(total, rnd) {
  const out = [];
  const bag = [];
  for (const rarity of RARITIES) {
    const slots = Math.max(1, Math.round(rarity.weight / 10));
    for (let i = 0; i < slots; i += 1) bag.push(rarity.id);
  }
  for (let i = 0; i < total; i += 1) {
    const pick = bag[Math.floor(rnd() * bag.length)] || 'common';
    out.push(pick);
  }
  // mindestens ein legendäres Pet bei >= 6 Pets
  if (total >= 6 && !out.includes('legendary')) out[out.length - 1] = 'legendary';
  return out;
}

/* --------------------------- Blueprint-Erzeugung ------------------------ */

export function createBlueprint(prompt = '', options = {}) {
  const text = String(prompt || '').trim();
  const lower = text.toLowerCase();
  const seed = hashString(`${text}|${options.seed || ''}`);
  const rnd = mulberry32(seed);
  const theme = detectTheme(lower);
  const genre = detectGenre(lower, theme);
  const isSimulator = /simulator|pets?|insel/.test(lower);

  const petCount = countFrom(lower, [/(\d+|[a-zäöüß]+)\s+(?:neue[nrs]?\s+)?pets?\b/], isSimulator ? 10 : 8, 60);
  const islandCount = countFrom(lower, [/(\d+|[a-zäöüß]+)\s+(?:neue[nrs]?\s+)?inseln?\b/], isSimulator ? 5 : 4, 20);
  const enemyCount = countFrom(lower, [/(\d+|[a-zäöüß]+)\s+(?:neue[nrs]?\s+)?(?:gegner|enemies|monster)\b/], 8, 40);
  const questCount = countFrom(lower, [/(\d+|[a-zäöüß]+)\s+(?:neue[nrs]?\s+)?quests?\b/], 5, 20);
  const bossCount = /boss/.test(lower) ? Math.max(1, Math.min(3, Math.floor(enemyCount / 5) + 1)) : 1;
  const maxLevel = clampInt(/(\d+)\s*(?:level|leveln)/.exec(lower)?.[1], 10, 500, 100);

  const islands = [];
  for (let i = 0; i < islandCount; i += 1) {
    const angle = (i / islandCount) * Math.PI * 2;
    const distance = 110 + (i % 2) * 55 + rnd() * 20;
    const radius = Math.round(34 + rnd() * 16);
    const buildings = [];
    const buildingCount = 2 + (i === 0 ? 1 : 0);
    for (let b = 0; b < buildingCount; b += 1) {
      const bAngle = (b / buildingCount) * Math.PI * 2 + rnd();
      buildings.push({
        name: nameAt(BUILDING_POOL, i * 3 + b),
        offset: [Math.round(Math.cos(bAngle) * radius * 0.55), Math.round(Math.sin(bAngle) * radius * 0.55)],
        size: [Math.round(12 + rnd() * 8), Math.round(10 + rnd() * 10), Math.round(12 + rnd() * 8)],
        color: theme.palette[(i + b) % theme.palette.length],
        kind: b === 0 ? 'shop' : b === 1 ? 'quest' : 'decor',
      });
    }
    islands.push({
      name: nameAt(ISLAND_POOL, i),
      position: [Math.round(Math.cos(angle) * distance), 0, Math.round(Math.sin(angle) * distance)],
      radius,
      height: 10,
      color: i % 2 === 0 ? theme.ground : theme.palette[i % theme.palette.length],
      buildings,
    });
  }

  const rarities = raritySequence(petCount, rnd);
  const pets = [];
  const perRarityIndex = {};
  for (let i = 0; i < petCount; i += 1) {
    const rarityId = rarities[i];
    const rarity = RARITIES.find((r) => r.id === rarityId) || RARITIES[0];
    const idx = perRarityIndex[rarityId] || 0;
    perRarityIndex[rarityId] = idx + 1;
    const baseName = nameAt(PET_POOL[rarityId] || PET_POOL.common, idx);
    pets.push({
      id: `pet_${i + 1}`,
      name: baseName,
      rarity: rarityId,
      multiplier: round1(rarity.multiplier * (1 + rnd() * 0.15)),
      color: rarity.color,
    });
  }

  const shopItems = [];
  const shopCount = Math.max(6, Math.min(16, petCount));
  for (let i = 0; i < shopCount; i += 1) {
    const kind = i % 4 === 0 ? 'pet' : i % 4 === 1 ? 'boost' : i % 4 === 2 ? 'tool' : 'pet';
    shopItems.push({
      id: `item_${i + 1}`,
      name: nameAt(ITEM_POOL, i),
      price: Math.round(50 * (i + 1) * (1 + rnd() * 0.4)),
      kind,
      description:
        kind === 'pet'
          ? 'Schaltet ein seltenes Pet frei.'
          : kind === 'boost'
            ? 'Erhöht deine Werte für kurze Zeit.'
            : 'Nützlicher Gegenstand für dein Inventar.',
    });
  }

  const enemies = [];
  for (let i = 0; i < enemyCount; i += 1) {
    const isBoss = i >= enemyCount - bossCount;
    const island = islands[i % islands.length];
    const angle = rnd() * Math.PI * 2;
    const dist = island.radius * 0.6;
    enemies.push({
      name: isBoss ? nameAt(BOSS_POOL, i) : nameAt(ENEMY_POOL, i),
      level: Math.max(1, Math.round((maxLevel / (enemyCount + 1)) * (i + 1))),
      hp: isBoss ? 900 + i * 250 : 120 + i * 45,
      damage: isBoss ? 24 : 8 + i * 2,
      isBoss,
      position: [
        island.position[0] + Math.round(Math.cos(angle) * dist),
        4,
        island.position[2] + Math.round(Math.sin(angle) * dist),
      ],
      color: isBoss ? theme.palette[0] : theme.palette[(i + 2) % theme.palette.length],
      rewardCoins: isBoss ? 500 + i * 100 : 25 + i * 10,
      rewardXp: isBoss ? 400 + i * 80 : 30 + i * 12,
      respawn: isBoss ? 45 : 12,
    });
  }

  const questKinds = ['defeat', 'hatch', 'buy'];
  const quests = [];
  for (let i = 0; i < questCount; i += 1) {
    const kind = questKinds[i % questKinds.length];
    const target = kind === 'defeat' ? enemies[i % enemies.length]?.name || null : null;
    const required = kind === 'defeat' ? 3 + i * 2 : kind === 'hatch' ? 2 + i : 1 + i;
    quests.push({
      id: `quest_${i + 1}`,
      title:
        kind === 'defeat'
          ? `Besiege ${target} ${required}x`
          : kind === 'hatch'
            ? `Brüte ${required} Pets aus`
            : `Kaufe ${required} Artikel im Shop`,
      description:
        kind === 'defeat'
          ? 'Besiege Gegner auf der Map und sammle Belohnungen.'
          : kind === 'hatch'
            ? 'Öffne Pet-Eier und erweitere deine Sammlung.'
            : 'Gib Münzen im Shop aus, um dein Inventar zu verbessern.',
      kind,
      targetName: target,
      required,
      rewardCoins: 100 + i * 75,
      rewardXp: 80 + i * 60,
    });
  }

  const npcs = [];
  const npcCount = Math.min(islands.length, 6);
  for (let i = 0; i < npcCount; i += 1) {
    const island = islands[i];
    npcs.push({
      name: nameAt(NPC_POOL, i),
      role: i === 0 ? 'guide' : i % 2 === 0 ? 'quest' : 'shop',
      position: [island.position[0] + 6, 0, island.position[2] + 6],
      color: theme.palette[(i + 1) % theme.palette.length],
      dialogue:
        i === 0
          ? `Willkommen in ${titleFromPrompt(text, theme)}! Sprich mit mir, um Quests zu starten.`
          : `Ich habe Aufgaben für dich. Besiege Gegner und sammle ${100 + i * 50} Münzen Belohnung!`,
    });
  }

  return {
    version: 1,
    engine: 'template',
    title: titleFromPrompt(text, theme),
    genre,
    summary: text || `Ein ${theme.label} mit ${islandCount} Inseln, ${pets.length} Pets, Shop, Quests und Bossen.`,
    prompt: text,
    theme,
    world: {
      size: [1024, 1024],
      islands,
    },
    pets,
    shopItems,
    quests,
    enemies,
    npcs,
    levels: { maxLevel, baseXp: 120, growth: 1.32 },
    ui: {
      title: titleFromPrompt(text, theme),
      accent: theme.palette[0],
      currencyName: 'Coins',
      panels: ['shop', 'pets', 'quests'],
    },
  };
}

/* --------------------------- Blueprint-Validierung --------------------- */

const HEX = /^#[0-9a-fA-F]{6}$/;

function safeColor(value, fallback) {
  return typeof value === 'string' && HEX.test(value) ? value : fallback;
}

function safeString(value, fallback, max = 200) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim().slice(0, max);
}

function safeNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeIsland(raw, index, base) {
  const fallback = base.world.islands[index % base.world.islands.length];
  const position = Array.isArray(raw?.position) ? raw.position : fallback.position;
  const buildings = Array.isArray(raw?.buildings) && raw.buildings.length
    ? raw.buildings.slice(0, 8).map((building, bIndex) => {
        const bFallback = fallback.buildings[bIndex % fallback.buildings.length];
        return {
          name: safeString(building?.name, `${bFallback.name} ${index + 1}`, 60),
          offset: Array.isArray(building?.offset) ? building.offset.slice(0, 2).map((n) => safeNumber(n, 0, -80, 80)) : bFallback.offset,
          size: Array.isArray(building?.size) ? building.size.slice(0, 3).map((n) => safeNumber(n, 10, 4, 60)) : bFallback.size,
          color: safeColor(building?.color, bFallback.color),
          kind: ['shop', 'quest', 'decor'].includes(building?.kind) ? building.kind : 'decor',
        };
      })
    : fallback.buildings;
  return {
    name: safeString(raw?.name, fallback.name, 60),
    position: position.slice(0, 3).map((n) => safeNumber(n, 0, -2000, 2000)),
    radius: safeNumber(raw?.radius, fallback.radius, 10, 200),
    height: safeNumber(raw?.height, fallback.height, 4, 60),
    color: safeColor(raw?.color, fallback.color),
    buildings,
  };
}

/**
 * Validiert und vervollständigt einen (ggf. von einem LLM erzeugten) Blueprint.
 * Fehlende Felder werden aus der Vorlagen-Engine ergänzt, Werte begrenzt.
 */
export function normalizeBlueprint(raw, prompt = '') {
  const base = createBlueprint(prompt || raw?.title || 'Roblox Spiel');
  if (!raw || typeof raw !== 'object') return base;

  const theme = raw.theme && typeof raw.theme === 'object'
    ? {
        id: safeString(raw.theme.id, base.theme.id, 30),
        label: safeString(raw.theme.label, base.theme.label, 60),
        sky: safeColor(raw.theme.sky, base.theme.sky),
        ground: safeColor(raw.theme.ground, base.theme.ground),
        water: safeColor(raw.theme.water, base.theme.water),
        palette: Array.isArray(raw.theme.palette) && raw.theme.palette.length
          ? raw.theme.palette.slice(0, 6).map((c, i) => safeColor(c, base.theme.palette[i % base.theme.palette.length]))
          : base.theme.palette,
      }
    : base.theme;

  const world = raw.world && typeof raw.world === 'object' ? raw.world : {};
  const islands = Array.isArray(world.islands) && world.islands.length
    ? world.islands.slice(0, 20).map((island, index) => normalizeIsland(island, index, base))
    : base.world.islands;

  const pets = Array.isArray(raw.pets) && raw.pets.length
    ? raw.pets.slice(0, 60).map((pet, index) => {
        const rarity = RARITIES.find((r) => r.id === pet?.rarity) || RARITIES[0];
        return {
          id: safeString(pet?.id, `pet_${index + 1}`, 40),
          name: safeString(pet?.name, `Pet ${index + 1}`, 60),
          rarity: rarity.id,
          multiplier: safeNumber(pet?.multiplier, rarity.multiplier, 1, 500),
          color: safeColor(pet?.color, rarity.color),
        };
      })
    : base.pets;

  const shopItems = Array.isArray(raw.shopItems) && raw.shopItems.length
    ? raw.shopItems.slice(0, 40).map((item, index) => ({
        id: safeString(item?.id, `item_${index + 1}`, 40),
        name: safeString(item?.name, `Artikel ${index + 1}`, 60),
        price: safeNumber(item?.price, 100 * (index + 1), 1, 1_000_000),
        kind: ['pet', 'boost', 'tool'].includes(item?.kind) ? item.kind : 'tool',
        description: safeString(item?.description, 'Artikel aus dem Shop.', 160),
      }))
    : base.shopItems;

  const quests = Array.isArray(raw.quests) && raw.quests.length
    ? raw.quests.slice(0, 30).map((quest, index) => ({
        id: safeString(quest?.id, `quest_${index + 1}`, 40),
        title: safeString(quest?.title, `Quest ${index + 1}`, 90),
        description: safeString(quest?.description, 'Erfülle das Ziel und erhalte Belohnungen.', 160),
        kind: ['defeat', 'hatch', 'buy'].includes(quest?.kind) ? quest.kind : 'defeat',
        targetName: typeof quest?.targetName === 'string' ? quest.targetName.slice(0, 60) : null,
        required: safeNumber(quest?.required, 3, 1, 999),
        rewardCoins: safeNumber(quest?.rewardCoins, 100, 0, 1_000_000),
        rewardXp: safeNumber(quest?.rewardXp, 80, 0, 1_000_000),
      }))
    : base.quests;

  const enemies = Array.isArray(raw.enemies) && raw.enemies.length
    ? raw.enemies.slice(0, 40).map((enemy, index) => {
        const fallback = base.enemies[index % base.enemies.length];
        return {
          name: safeString(enemy?.name, `Gegner ${index + 1}`, 60),
          level: safeNumber(enemy?.level, fallback.level, 1, 999),
          hp: safeNumber(enemy?.hp, fallback.hp, 10, 100_000),
          damage: safeNumber(enemy?.damage, fallback.damage, 1, 5000),
          isBoss: Boolean(enemy?.isBoss),
          position: Array.isArray(enemy?.position)
            ? enemy.position.slice(0, 3).map((n) => safeNumber(n, 0, -2000, 2000))
            : fallback.position,
          color: safeColor(enemy?.color, fallback.color),
          rewardCoins: safeNumber(enemy?.rewardCoins, fallback.rewardCoins, 0, 100_000),
          rewardXp: safeNumber(enemy?.rewardXp, fallback.rewardXp, 0, 100_000),
          respawn: safeNumber(enemy?.respawn, fallback.respawn, 3, 600),
        };
      })
    : base.enemies;

  const npcs = Array.isArray(raw.npcs) && raw.npcs.length
    ? raw.npcs.slice(0, 20).map((npc, index) => {
        const fallback = base.npcs[index % base.npcs.length];
        return {
          name: safeString(npc?.name, `NPC ${index + 1}`, 60),
          role: ['guide', 'quest', 'shop'].includes(npc?.role) ? npc.role : 'guide',
          position: Array.isArray(npc?.position)
            ? npc.position.slice(0, 3).map((n) => safeNumber(n, 0, -2000, 2000))
            : fallback.position,
          color: safeColor(npc?.color, fallback.color),
          dialogue: safeString(npc?.dialogue, fallback.dialogue, 240),
        };
      })
    : base.npcs;

  return {
    version: 1,
    engine: raw.engine === 'ai' ? 'ai' : 'template',
    title: safeString(raw.title, base.title, 80),
    genre: safeString(raw.genre, base.genre, 40),
    summary: safeString(raw.summary, base.summary, 600),
    prompt: base.prompt,
    theme,
    world: { size: base.world.size, islands },
    pets,
    shopItems,
    quests,
    enemies,
    npcs,
    levels: {
      maxLevel: safeNumber(raw.levels?.maxLevel, base.levels.maxLevel, 10, 500),
      baseXp: safeNumber(raw.levels?.baseXp, base.levels.baseXp, 10, 100_000),
      growth: safeNumber(raw.levels?.growth, base.levels.growth, 1.05, 3),
    },
    ui: {
      title: safeString(raw.ui?.title, base.ui.title, 80),
      accent: safeColor(raw.ui?.accent, base.ui.accent),
      currencyName: safeString(raw.ui?.currencyName, base.ui.currencyName, 20),
      panels: Array.isArray(raw.ui?.panels) && raw.ui.panels.length ? raw.ui.panels.slice(0, 6) : base.ui.panels,
    },
  };
}

/* ------------------------------ Textausgabe ---------------------------- */

/** Kompakte Beschreibung des Blueprints - für Chat-Kontext und UI. */
export function blueprintSummary(blueprint) {
  if (!blueprint) return 'Kein Blueprint vorhanden.';
  const lines = [
    `Titel: ${blueprint.title} (${blueprint.genre})`,
    `Zusammenfassung: ${blueprint.summary}`,
    `Inseln (${blueprint.world.islands.length}): ${blueprint.world.islands.map((i) => i.name).join(', ')}`,
    `Pets (${blueprint.pets.length}): ${blueprint.pets.map((p) => `${p.name} [${p.rarity}]`).join(', ')}`,
    `Shop (${blueprint.shopItems.length}): ${blueprint.shopItems.map((i) => `${i.name} (${i.price})`).join(', ')}`,
    `Quests (${blueprint.quests.length}): ${blueprint.quests.map((q) => q.title).join(' | ')}`,
    `Gegner (${blueprint.enemies.length}): ${blueprint.enemies.map((e) => `${e.name} Lv${e.level}${e.isBoss ? ' (Boss)' : ''}`).join(', ')}`,
    `NPCs (${blueprint.npcs.length}): ${blueprint.npcs.map((n) => `${n.name} (${n.role})`).join(', ')}`,
    `Levelsystem: max. Level ${blueprint.levels.maxLevel}, Basis-XP ${blueprint.levels.baseXp}, Wachstum ${blueprint.levels.growth}`,
  ];
  return lines.join('\n');
}
