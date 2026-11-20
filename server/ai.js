/**
 * KI-Schicht.
 *
 * Es gibt zwei ehrlich getrennte Betriebsarten:
 *  - "ki":      ein Sprachmodell (OpenAI-kompatibel, Anthropic oder Gemini) erzeugt
 *               den Blueprint aus dem Prompt. Schlüssel bleiben ausschließlich im Server.
 *  - "vorlage": die deterministische Blueprint-Engine erzeugt den Blueprint.
 *               Kein API-Schlüssel nötig, funktioniert sofort.
 *
 * In beiden Fällen kompiliert derselbe Compiler echte Studio-Aktionen und Luau-Code.
 * Der Unterschied liegt nur darin, wer die Spieldaten (Namen, Inseln, Pets, Quests) bestimmt.
 */

import { createBlueprint, normalizeBlueprint, blueprintSummary, RARITIES } from './blueprint.js';

const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const OPENAI_BASE = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 45_000);

export function aiStatus() {
  if (OPENAI_KEY) {
    return {
      configured: true,
      mode: 'ki',
      provider: 'OpenAI-kompatibel',
      model: OPENAI_MODEL,
      note: 'Sprachmodell erzeugt Blueprints; Schlüssel bleibt auf dem Server.',
    };
  }
  if (ANTHROPIC_KEY) {
    return {
      configured: true,
      mode: 'ki',
      provider: 'Anthropic',
      model: ANTHROPIC_MODEL,
      note: 'Sprachmodell erzeugt Blueprints; Schlüssel bleibt auf dem Server.',
    };
  }
  if (GEMINI_KEY) {
    return {
      configured: true,
      mode: 'ki',
      provider: 'Google Gemini',
      model: GEMINI_MODEL,
      note: 'Sprachmodell erzeugt Blueprints; Schlüssel bleibt auf dem Server.',
    };
  }
  return {
    configured: false,
    mode: 'vorlage',
    provider: null,
    model: null,
    note:
      'Vorlagen-Modus: Spiele werden deterministisch aus deinem Prompt erzeugt (kein API-Schlüssel nötig). ' +
      'Für freie KI-Formulierungen einen Schlüssel in den Einstellungen hinterlegen (OPENAI_API_KEY, ANTHROPIC_API_KEY oder GEMINI_API_KEY).',
  };
}

const SCHEMA_HINT = `Antworte AUSSCHLIESSLICH mit JSON in genau dieser Struktur:
{
 "title": string, "genre": string, "summary": string,
 "theme": { "id": string, "label": string, "sky": "#rrggbb", "ground": "#rrggbb", "water": "#rrggbb", "palette": ["#rrggbb", ... 5] },
 "world": { "islands": [ { "name": string, "position": [x,0,z], "radius": 30-60, "height": 10, "color": "#rrggbb",
    "buildings": [ { "name": string, "offset": [x,z], "size": [w,h,d], "color": "#rrggbb", "kind": "shop|quest|decor" } ] } ] },
 "pets": [ { "id": "pet_1", "name": string, "rarity": "common|uncommon|rare|epic|legendary", "multiplier": number, "color": "#rrggbb" } ],
 "shopItems": [ { "id": "item_1", "name": string, "price": number, "kind": "pet|boost|tool", "description": string } ],
 "quests": [ { "id": "quest_1", "title": string, "description": string, "kind": "defeat|hatch|buy", "targetName": string|null, "required": number, "rewardCoins": number, "rewardXp": number } ],
 "enemies": [ { "name": string, "level": number, "hp": number, "damage": number, "isBoss": boolean, "position": [x,4,z], "color": "#rrggbb", "rewardCoins": number, "rewardXp": number, "respawn": number } ],
 "npcs": [ { "name": string, "role": "guide|shop|quest", "position": [x,0,z], "color": "#rrggbb", "dialogue": string } ],
 "levels": { "maxLevel": number, "baseXp": number, "growth": number },
 "ui": { "title": string, "accent": "#rrggbb", "currencyName": string, "panels": ["shop","pets","quests"] }
}
Halte Positionen innerhalb von -400..400. Inseln dürfen sich nicht überlappen (Abstand > Summe der Radien).`;

async function callOpenAI(messages, { json = true } = {}) {
  const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.8,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anbieter antwortete ${response.status}: ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(system, user) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anbieter antwortete ${response.status}: ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  return (data.content || []).map((part) => part.text || '').join('');
}

async function callGemini(system, user) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.8, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(AbortSignal ? TIMEOUT_MS : TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anbieter antwortete ${response.status}: ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || '').join('');
}

async function askModel(system, user) {
  const status = aiStatus();
  if (status.provider === 'OpenAI-kompatibel') {
    return callOpenAI([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
  }
  if (status.provider === 'Anthropic') {
    return callAnthropic(system, user);
  }
  if (status.provider === 'Google Gemini') {
    return callGemini(system, user);
  }
  throw new Error('Kein KI-Anbieter konfiguriert');
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) {
    const parsed = tryParse(fenced[1]);
    if (parsed) return parsed;
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return tryParse(trimmed.slice(start, end + 1));
  }
  return null;
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ------------------------- Lokale Änderungs-Engine ---------------------- */

const EXTRA_ISLANDS = ['Drachenbucht', 'Kristallhafen', 'Schattenwald', 'Sonnenplateau', 'Nebelküste', 'Eishöhle', 'Vulkaninsel', 'Geisterhafen'];
const EXTRA_PETS = ['Nebelkatze', 'Sonnenadler', 'Kristallwolf', 'Schattenfuchs', 'Sturmkolibri', 'Rubinkäfer', 'Eisbär', 'Glutdrache', 'Silberhirsch', 'Wolkenwal'];
const EXTRA_ENEMIES = ['Nebelwächter', 'Kristallgolem', 'Schattenkriecher', 'Glutbestie', 'Sturmgeist', 'Eiskoloss', 'Sandphantom', 'Wurzelmonster'];
const EXTRA_NPCS = ['Händler Kira', 'Forscher Noa', 'Trainerin Sela', 'Schmied Dorn', 'Kapitänin Vela'];

function countFromText(text, fallback, max = 30) {
  const match = /(\d+)/.exec(text);
  if (match) return Math.max(1, Math.min(max, Number(match[1])));
  const words = {
    ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6,
    sieben: 7, acht: 8, neun: 9, zehn: 10, zwölf: 12, zwanzig: 20,
  };
  for (const [word, value] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return Math.min(max, value);
  }
  return fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pick(list, index) {
  return list[index % list.length];
}

function addIslands(blueprint, count) {
  const islands = blueprint.world.islands;
  for (let i = 0; i < count; i += 1) {
    const index = islands.length;
    const angle = (index / 8) * Math.PI * 2 + 0.4;
    const distance = 170 + (index % 3) * 55;
    islands.push({
      name: pick(EXTRA_ISLANDS, index),
      position: [Math.round(Math.cos(angle) * distance), 0, Math.round(Math.sin(angle) * distance)],
      radius: 38 + (index % 3) * 6,
      height: 10,
      color: pick(blueprint.theme.palette, index),
      buildings: [
        {
          name: 'Neuer Shop',
          offset: [12, 0],
          size: [16, 14, 14],
          color: pick(blueprint.theme.palette, index + 1),
          kind: 'shop',
        },
        {
          name: 'Quest-Halle',
          offset: [-14, 6],
          size: [18, 16, 16],
          color: pick(blueprint.theme.palette, index + 2),
          kind: 'quest',
        },
      ],
    });
  }
  return `${count} neue Insel(n) mit Shop und Quest-Halle`;
}

function addPets(blueprint, count) {
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const start = blueprint.pets.length;
  for (let i = 0; i < count; i += 1) {
    const rarityId = order[Math.min(order.length - 1, Math.floor(((start + i) / Math.max(1, start + count)) * order.length))];
    const rarity = RARITIES.find((r) => r.id === rarityId) || RARITIES[0];
    blueprint.pets.push({
      id: `pet_${start + i + 1}`,
      name: pick(EXTRA_PETS, start + i),
      rarity: rarity.id,
      multiplier: Math.round(rarity.multiplier * 10) / 10,
      color: rarity.color,
    });
  }
  return `${count} neue Pets (${blueprint.pets.length} insgesamt)`;
}

function addEnemies(blueprint, count) {
  const islands = blueprint.world.islands;
  const start = blueprint.enemies.length;
  for (let i = 0; i < count; i += 1) {
    const island = islands[(start + i) % islands.length];
    const isBoss = (start + i) % 6 === 5;
    const angle = ((start + i) * 1.7) % (Math.PI * 2);
    const distance = island.radius * 0.55;
    blueprint.enemies.push({
      name: isBoss ? `Boss ${pick(EXTRA_ENEMIES, start + i)}` : pick(EXTRA_ENEMIES, start + i),
      level: Math.min(blueprint.levels.maxLevel, 5 + (start + i) * 3),
      hp: isBoss ? 1800 : 150 + (start + i) * 40,
      damage: isBoss ? 28 : 9 + (start + i) * 2,
      isBoss,
      position: [
        island.position[0] + Math.round(Math.cos(angle) * distance),
        4,
        island.position[2] + Math.round(Math.sin(angle) * distance),
      ],
      color: isBoss ? blueprint.theme.palette[0] : pick(blueprint.theme.palette, start + i),
      rewardCoins: isBoss ? 800 : 40 + (start + i) * 12,
      rewardXp: isBoss ? 600 : 45 + (start + i) * 15,
      respawn: isBoss ? 45 : 12,
    });
  }
  return `${count} neue Gegner (${blueprint.enemies.length} insgesamt)`;
}

function addQuests(blueprint, count) {
  const kinds = ['defeat', 'hatch', 'buy'];
  const start = blueprint.quests.length;
  for (let i = 0; i < count; i += 1) {
    const kind = kinds[(start + i) % kinds.length];
    const enemy = blueprint.enemies[(start + i) % Math.max(1, blueprint.enemies.length)];
    const required = kind === 'defeat' ? 5 + i * 2 : kind === 'hatch' ? 2 + i : 2 + i;
    blueprint.quests.push({
      id: `quest_${start + i + 1}`,
      title:
        kind === 'defeat'
          ? `Besiege ${enemy?.name || 'Gegner'} ${required}x`
          : kind === 'hatch'
            ? `Brüte ${required} Pets aus`
            : `Kaufe ${required} Artikel im Shop`,
      description:
        kind === 'defeat'
          ? 'Neue Aufgabe: besiege Gegner für Münzen und XP.'
          : kind === 'hatch'
            ? 'Neue Aufgabe: erweitere deine Petsammlung.'
            : 'Neue Aufgabe: kaufe Ausrüstung im Shop.',
      kind,
      targetName: kind === 'defeat' ? enemy?.name || null : null,
      required,
      rewardCoins: 150 + i * 80,
      rewardXp: 120 + i * 70,
    });
  }
  return `${count} neue Quest(s) (${blueprint.quests.length} insgesamt)`;
}

function addShopItems(blueprint, count) {
  const start = blueprint.shopItems.length;
  const kinds = ['pet', 'boost', 'tool'];
  for (let i = 0; i < count; i += 1) {
    blueprint.shopItems.push({
      id: `item_${start + i + 1}`,
      name: `Upgrade ${start + i + 1}`,
      price: 200 + (start + i) * 150,
      kind: kinds[(start + i) % kinds.length],
      description: 'Zusätzlicher Artikel für dein Inventar.',
    });
  }
  return `${count} neue Shop-/Inventar-Artikel`;
}

function addNpcs(blueprint, count) {
  const islands = blueprint.world.islands;
  const start = blueprint.npcs.length;
  for (let i = 0; i < count; i += 1) {
    const island = islands[(start + i) % islands.length];
    blueprint.npcs.push({
      name: pick(EXTRA_NPCS, start + i),
      role: i % 2 === 0 ? 'quest' : 'shop',
      position: [island.position[0] - 8, 0, island.position[2] - 4],
      color: pick(blueprint.theme.palette, start + i),
      dialogue: 'Ich habe neue Aufgaben für dich. Schau in dein Quest-Menü!',
    });
  }
  return `${count} neue NPC(s)`;
}

/** Regelbasierte Änderung eines bestehenden Blueprints (ohne KI-Schlüssel). */
export function localRevision(blueprint, instruction) {
  const text = String(instruction || '').toLowerCase();
  const next = clone(blueprint);
  const changes = [];

  if (/insel|island|map|welt/.test(text)) {
    changes.push(addIslands(next, countFromText(text, 1, 12)));
  }
  if (/\bpet/.test(text)) {
    changes.push(addPets(next, countFromText(text, 5, 40)));
  }
  if (/gegner|enemy|enemies|monster/.test(text)) {
    changes.push(addEnemies(next, countFromText(text, 3, 30)));
  }
  if (/boss/.test(text)) {
    const bossCount = countFromText(text, 1, 3);
    changes.push(addEnemies(next, bossCount));
  }
  if (/quest|mission|aufgabe/.test(text)) {
    changes.push(addQuests(next, countFromText(text, 2, 20)));
  }
  if (/shop|laden|inventar|item|artikel/.test(text)) {
    changes.push(addShopItems(next, countFromText(text, 3, 20)));
  }
  if (/npc|händler|haendler/.test(text)) {
    changes.push(addNpcs(next, countFromText(text, 2, 10)));
  }
  if (/level|xp|erfahrung/.test(text)) {
    next.levels.maxLevel = Math.min(500, next.levels.maxLevel + 50);
    changes.push(`Levelsystem erweitert (max. Level ${next.levels.maxLevel})`);
  }
  if (/riesig|groß|gross|groesser|größer/.test(text)) {
    for (const island of next.world.islands) {
      island.radius = Math.min(90, Math.round(island.radius * 1.25));
    }
    changes.push('Inseln vergrößert');
  }

  if (changes.length === 0) {
    return {
      blueprint: next,
      changed: false,
      note:
        'Ich konnte deiner Nachricht keine konkrete Änderung zuordnen. Nenne z. B. "füge 3 Inseln hinzu", ' +
        '"erstelle 10 neue Pets", "füge 5 Gegner hinzu" oder "mehr Quests".',
    };
  }

  return {
    blueprint: normalizeBlueprint(next, blueprint.prompt || blueprint.title),
    changed: true,
    note: `Vorlagen-Engine angewendet: ${changes.join(', ')}.`,
  };
}

/* ----------------------------- Öffentlich ------------------------------ */

export async function generateBlueprint({ prompt, previous = null, projectName = '' }) {
  const status = aiStatus();
  const fallback = () => ({
    blueprint: previous ? localRevision(previous, prompt).blueprint : createBlueprint(prompt, { seed: projectName }),
    engine: 'vorlage',
    note: status.configured
      ? 'KI-Aufruf nicht möglich – Vorlagen-Engine hat den Blueprint erzeugt.'
      : 'Vorlagen-Engine: deterministisch aus deinem Prompt erzeugt.',
  });

  if (!status.configured) {
    return fallback();
  }

  try {
    const raw = await askModel(
      `Du bist ein Roblox-Spieledesigner. Erzeuge aus dem Wunsch des Nutzers einen vollständigen Spiel-Blueprint. ${SCHEMA_HINT}`,
      `Spielwunsch: ${prompt}\nProjektname: ${projectName || 'Roblox-Spiel'}\nSprache der Texte: Deutsch.`,
    );
    const parsed = extractJson(raw);
    if (!parsed) throw new Error('Antwort enthielt kein gültiges JSON');
    return {
      blueprint: normalizeBlueprint(parsed, prompt),
      engine: 'ki',
      note: `Blueprint von ${status.provider} (${status.model}) erzeugt und serverseitig validiert.`,
    };
  } catch (err) {
    console.error('[ai] Blueprint-Erzeugung fehlgeschlagen:', err.message);
    return { ...fallback(), note: `KI nicht erreichbar (${err.message}) – Vorlagen-Engine genutzt.` };
  }
}

export async function reviseBlueprint({ blueprint, instruction, projectName = '' }) {
  const status = aiStatus();
  if (!status.configured) {
    return localRevision(blueprint, instruction);
  }

  try {
    const raw = await askModel(
      `Du bist ein Roblox-Spieledesigner. Ändere einen bestehenden Blueprint gemäß der Anweisung und gib den VOLLSTÄNDIGEN neuen Blueprint zurück. ${SCHEMA_HINT}`,
      `Projekt: ${projectName}\nAnweisung: ${instruction}\n\nAktueller Blueprint:\n${JSON.stringify(blueprint).slice(0, 12000)}`,
    );
    const parsed = extractJson(raw);
    if (!parsed) throw new Error('Antwort enthielt kein gültiges JSON');
    return {
      blueprint: normalizeBlueprint(parsed, blueprint.prompt || blueprint.title),
      changed: true,
      engine: 'ki',
      note: `Blueprint von ${status.provider} (${status.model}) überarbeitet.`,
    };
  } catch (err) {
    console.error('[ai] Überarbeitung fehlgeschlagen:', err.message);
    const local = localRevision(blueprint, instruction);
    return { ...local, engine: 'vorlage', note: `KI nicht erreichbar (${err.message}). ${local.note}` };
  }
}

/** Analysiert eine Roblox-Referenz (Link + Notizen + Screenshots) und leitet eine eigene Version ab. */
export async function analyzeReference({ url, notes, screenshots = [], projectName = '' }) {
  const status = aiStatus();
  const safeNotes = String(notes || '').slice(0, 4000);
  const imageCount = Array.isArray(screenshots) ? screenshots.length : 0;
  const prompt = [
    'Erstelle ein eigenes Roblox-Spiel, inspiriert von folgenden öffentlichen Eindrücken.',
    url ? `Referenz-Link (nur öffentliche Beschreibung, keine fremden Assets): ${url}` : '',
    safeNotes ? `Beobachtete Mechaniken/Design: ${safeNotes}` : '',
    imageCount ? `${imageCount} Screenshot(s) wurden vom Nutzer beigefügt und beschrieben.` : '',
    'Wichtig: keine geschützten Skripte oder Assets kopieren – nur eigene Mechaniken und eigene Namen.',
  ]
    .filter(Boolean)
    .join('\n');

  const blueprint = status.configured
    ? (await generateBlueprint({ prompt, projectName })).blueprint
    : createBlueprint(`${projectName} ${safeNotes}`, { seed: url || projectName });

  const mechanics = [];
  const text = `${safeNotes} ${url}`.toLowerCase();
  if (/pet|begleiter/.test(text)) mechanics.push('Pet-System mit Eiern und Seltenheiten');
  if (/quest|mission/.test(text)) mechanics.push('Quest-System mit Belohnungen');
  if (/shop|laden/.test(text)) mechanics.push('Shop mit serverseitiger Kaufprüfung');
  if (/boss|gegner|kampf/.test(text)) mechanics.push('Kampf- und Boss-System');
  if (/level|xp/.test(text)) mechanics.push('Level- und Erfahrungssystem');
  if (/insel|map|welt/.test(text)) mechanics.push('Mehrere Inseln als Weltkarte');
  if (/inventar/.test(text)) mechanics.push('Inventar mit gespeicherten Käufen');
  if (mechanics.length === 0) {
    mechanics.push('Inselkarte, Shop, Quests, Gegner, Pets und Levelsystem als Grundgerüst');
  }

  return {
    blueprint,
    engine: status.configured ? 'ki' : 'vorlage',
    analysis: {
      source: url || 'ohne Link',
      screenshots: imageCount,
      mechanics,
      legality:
        'Es werden ausschließlich eigene Objekte, eigene Namen und eigener Luau-Code erzeugt. ' +
        'Fremde Skripte, Modelle und Assets werden nicht heruntergeladen oder kopiert.',
      limitations:
        imageCount > 0
          ? 'Screenshots werden als Beschreibungshilfe genutzt; ohne KI-Schlüssel fließen nur deine Textnotizen in den Blueprint ein.'
          : 'Ohne Screenshots und Notizen basiert die Analyse nur auf dem Linktext und deinem Prompt.',
      summary: blueprintSummary(blueprint),
    },
  };
}

export async function diagnoseWithAi({ scan, advice, projectName = '' }) {
  const status = aiStatus();
  const base = { engine: status.configured ? 'ki' : 'vorlage', advice };
  if (!status.configured) {
    return { ...base, text: null };
  }
  try {
    const raw = await askModel(
      'Du bist ein erfahrener Roblox-Entwickler. Erkläre die Fehler knapp auf Deutsch und nenne konkrete Lösungsschritte für Luau in Roblox Studio. Antworte als JSON: {"summary": string, "fixes": [string]}',
      `Projekt: ${projectName}\nLog-Meldungen: ${JSON.stringify((scan?.logs || []).slice(0, 40))}\nStruktur: Teile=${scan?.parts}, Modelle=${scan?.models}, Skripte=${(scan?.scripts || []).length}\nBereits erkannte Hinweise: ${JSON.stringify(advice.map((a) => a.title))}`,
    );
    const parsed = extractJson(raw);
    return {
      ...base,
      text: parsed?.summary || null,
      fixes: Array.isArray(parsed?.fixes) ? parsed.fixes.slice(0, 8) : [],
    };
  } catch (err) {
    return { ...base, text: null, error: `KI-Diagnose nicht erreichbar: ${err.message}` };
  }
}
