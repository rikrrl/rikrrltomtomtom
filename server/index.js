import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from './store.js';
import { compileBlueprint, scriptOverview, getScript } from './compiler.js';
import { blueprintSummary } from './blueprint.js';
import { aiStatus, generateBlueprint, reviseBlueprint, analyzeReference, diagnoseWithAi } from './ai.js';
import { analyzeScan } from './diagnostics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PLUGIN_FILE = path.join(ROOT_DIR, 'plugin', 'RobloxStudioAI.plugin.lua');
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const VERSION = '1.0.0';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '12mb' }));

/* ------------------------------- Zugangsschutz -------------------------- */

function keyMatches(candidate) {
  if (!APP_PASSWORD) return true;
  if (!candidate) return false;
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(APP_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.use('/api', (req, res, next) => {
  // Das Studio-Plugin authentifiziert sich mit dem Projekt-Token.
  if (req.path.startsWith('/plugin/')) return next();
  if (keyMatches(req.get('x-app-key') || req.query.key)) return next();
  return res.status(401).json({ error: 'Zugriffscode erforderlich', requiresKey: true });
});

/* --------------------------------- Helfer ------------------------------- */

function pluginOnline(project) {
  const lastSeen = project?.plugin?.lastSeen ? new Date(project.plugin.lastSeen).getTime() : 0;
  return Date.now() - lastSeen < 30_000;
}

function projectView(project) {
  const blueprint = project.blueprint;
  return {
    id: project.id,
    name: project.name,
    prompt: project.prompt,
    engine: project.engine,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    token: project.token,
    settings: project.settings,
    plugin: {
      online: pluginOnline(project),
      lastSeen: project.plugin?.lastSeen || null,
      placeName: project.plugin?.placeName || null,
      placeId: project.plugin?.placeId || null,
      studioVersion: project.plugin?.studioVersion || null,
      lastScan: project.plugin?.lastScan || null,
      snapshot: project.plugin?.snapshot
        ? {
            placeName: project.plugin.snapshot.placeName,
            parts: project.plugin.snapshot.parts,
            models: project.plugin.snapshot.models,
            unanchoredParts: project.plugin.snapshot.unanchoredParts,
            scripts: project.plugin.snapshot.scripts?.length || 0,
            logs: project.plugin.snapshot.logs?.length || 0,
          }
        : null,
    },
    counts: {
      islands: blueprint?.world?.islands?.length || 0,
      pets: blueprint?.pets?.length || 0,
      enemies: blueprint?.enemies?.length || 0,
      bosses: blueprint?.enemies?.filter((e) => e.isBoss).length || 0,
      quests: blueprint?.quests?.length || 0,
      shopItems: blueprint?.shopItems?.length || 0,
      npcs: blueprint?.npcs?.length || 0,
    },
    summary: blueprint ? blueprintSummary(blueprint) : null,
    scripts: blueprint ? scriptOverview(blueprint) : [],
    actionCounts: countActions(project.id),
  };
}

function countActions(projectId) {
  const actions = store.listActions(projectId);
  const counts = { pending: 0, approved: 0, delivered: 0, done: 0, failed: 0, rejected: 0, total: actions.length };
  for (const action of actions) {
    if (counts[action.status] !== undefined) counts[action.status] += 1;
  }
  return counts;
}

function supersedeOpenActions(projectId, reason) {
  let count = 0;
  for (const action of store.listActions(projectId)) {
    if (action.status === 'pending' || action.status === 'approved') {
      store.updateAction(action.id, { status: 'rejected', error: reason });
      count += 1;
    }
  }
  return count;
}

async function buildFromPrompt(project, prompt) {
  const result = await generateBlueprint({ prompt, projectName: project.name });
  const superseded = supersedeOpenActions(project.id, 'Durch neue Generierung ersetzt');
  const actions = compileBlueprint(result.blueprint, { mode: 'full' });
  const created = store.addActions(project.id, actions);
  store.updateProject(project.id, {
    blueprint: result.blueprint,
    prompt,
    engine: result.engine,
  });
  return { blueprint: result.blueprint, created, note: result.note, superseded };
}

async function reviseProject(project, instruction) {
  const result = await reviseBlueprint({
    blueprint: project.blueprint,
    instruction,
    projectName: project.name,
  });
  if (!result.changed) {
    return { changed: false, note: result.note, created: [] };
  }
  const superseded = supersedeOpenActions(project.id, 'Durch neue Änderung ersetzt');
  const actions = compileBlueprint(result.blueprint, { mode: 'patch' });
  const created = store.addActions(project.id, actions);
  store.updateProject(project.id, { blueprint: result.blueprint, engine: result.engine });
  return { changed: true, note: result.note, created, superseded, engine: result.engine };
}

function actionSummaryText(created) {
  const scripts = created.filter((a) => a.type === 'createScript').length;
  const objects = created.filter((a) => a.type === 'createTree').length;
  const other = created.length - scripts - objects;
  const parts = [];
  if (objects) parts.push(`${objects} Objekt-Bauaufträge`);
  if (scripts) parts.push(`${scripts} Luau-Skripte`);
  if (other) parts.push(`${other} weitere Aktionen`);
  return parts.join(', ');
}

/* --------------------------------- Status ------------------------------- */

app.get('/api/status', (req, res) => {
  res.json({
    version: VERSION,
    ai: aiStatus(),
    protected: Boolean(APP_PASSWORD),
    projects: store.listProjects().length,
    uptimeSeconds: Math.round(process.uptime()),
    plugin: {
      available: fs.existsSync(PLUGIN_FILE),
      downloadPath: '/plugin/RobloxStudioAI.lua',
    },
    storage: {
      kind: 'JSON-Datei auf dem Server',
      persistentDisk: false,
      note: 'Projekte liegen in data/db.json. Ohne dauerhafte Festplatte kann ein Redeploy die Datei zurücksetzen.',
    },
  });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

/* -------------------------------- Projekte ------------------------------ */

app.get('/api/projects', (req, res) => {
  res.json({ projects: store.listProjects() });
});

app.post('/api/projects', async (req, res, next) => {
  try {
    const { name, prompt = '', generate = false } = req.body || {};
    const project = store.createProject({
      name: name || (prompt ? prompt.slice(0, 60) : 'Neues Roblox-Projekt'),
      prompt,
    });
    let generation = null;
    if (generate && prompt.trim()) {
      generation = await buildFromPrompt(project, prompt.trim());
      store.addMessage(project.id, {
        role: 'assistant',
        content:
          `Projekt "${project.name}" angelegt.\n${generation.note}\n\n` +
          `Geplant: ${actionSummaryText(generation.created)}.\n` +
          'Bitte prüfe die Aktionen und gib sie frei – danach baut das Studio-Plugin das Spiel.',
        meta: { engine: generation.blueprint.engine, actions: generation.created.length },
      });
    }
    res.status(201).json({
      project: projectView(store.getProject(project.id)),
      actions: generation ? generation.created.length : 0,
      note: generation?.note || null,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/projects/:id', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  res.json({
    project: projectView(project),
    messages: store.listMessages(project.id),
    actions: store.listActions(project.id).slice(-200).reverse(),
    analyses: store.listAnalyses ? store.listAnalyses(project.id) : [],
  });
});

app.patch('/api/projects/:id', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  const { name, autoApprove } = req.body || {};
  const patch = {};
  if (typeof name === 'string' && name.trim()) patch.name = name.trim().slice(0, 120);
  if (typeof autoApprove === 'boolean') {
    patch.settings = { ...project.settings, autoApprove };
  }
  store.updateProject(project.id, patch);
  res.json({ project: projectView(store.getProject(project.id)) });
});

app.delete('/api/projects/:id', (req, res) => {
  const removed = store.deleteProject(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  res.json({ ok: true });
});

/* ------------------------------ Generierung ----------------------------- */

app.post('/api/projects/:id/generate', async (req, res, next) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });
    const prompt = String(req.body?.prompt || project.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Bitte beschreibe dein Spiel' });

    store.addMessage(project.id, { role: 'user', content: prompt });
    const result = await buildFromPrompt(project, prompt);
    store.addMessage(project.id, {
      role: 'assistant',
      content:
        `${result.note}\n\n${blueprintSummary(result.blueprint)}\n\n` +
        `Erzeugt: ${actionSummaryText(result.created)}.` +
        (result.superseded ? `\n${result.superseded} ältere Aktion(en) wurden ersetzt.` : '') +
        '\n\nNächster Schritt: Aktionen freigeben und im Studio-Plugin ausführen lassen.',
      meta: { engine: result.engine, actions: result.created.length },
    });
    res.json({
      project: projectView(store.getProject(project.id)),
      note: result.note,
      actions: store.listActions(project.id, 'pending').map((a) => ({
        id: a.id,
        type: a.type,
        summary: a.summary,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------- Chat -------------------------------- */

app.post('/api/projects/:id/chat', async (req, res, next) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Nachricht fehlt' });

    store.addMessage(project.id, { role: 'user', content: message });

    const wantsDiagnosis = /fehler|bug|error|reparier|fix|problem/i.test(message);
    const hasBlueprint = Boolean(project.blueprint);

    if (!hasBlueprint) {
      const result = await buildFromPrompt(project, message);
      const reply =
        `${result.note}\n\n${blueprintSummary(result.blueprint)}\n\n` +
        `Erzeugt: ${actionSummaryText(result.created)}. ` +
        'Bitte gib die Aktionen frei, damit das Studio-Plugin sie einbaut.';
      store.addMessage(project.id, {
        role: 'assistant',
        content: reply,
        meta: { engine: result.engine, actions: result.created.length, kind: 'generate' },
      });
    } else if (wantsDiagnosis) {
      const snapshot = project.plugin?.snapshot;
      if (!snapshot) {
        const reply =
          'Für eine echte Fehleranalyse brauche ich einen Scan aus Studio.\n\n' +
          '1. Plugin in Roblox Studio öffnen und verbinden\n' +
          '2. "Projekt scannen & Fehler senden" drücken\n' +
          '3. Dann hier erneut fragen – ich werte Log-Meldungen und Struktur aus.\n\n' +
          'Ohne Scan kann ich nur allgemein antworten, nicht zu deinem konkreten Spiel.';
        store.addMessage(project.id, { role: 'assistant', content: reply, meta: { kind: 'need-scan' } });
      } else {
        const report = analyzeScan(snapshot);
        const ai = await diagnoseWithAi({
          scan: snapshot,
          advice: report.advice,
          projectName: project.name,
        });
        const lines = [`Scan von "${snapshot.placeName || 'Studio'}" (${snapshot.parts} Teile, ${snapshot.scripts?.length || 0} Skripte).`];
        if (report.advice.length === 0) {
          lines.push('Keine klaren Fehler in den Log-Meldungen gefunden.');
        } else {
          lines.push(`Ich habe ${report.advice.length} Hinweis(e):`);
          for (const item of report.advice.slice(0, 8)) {
            lines.push(`• ${item.title}: ${item.detail}`);
          }
        }
        if (ai.text) lines.push(`\nKI-Einschätzung: ${ai.text}`);
        for (const fix of ai.fixes || []) lines.push(`→ ${fix}`);
        const reply = lines.join('\n');
        store.addMessage(project.id, {
          role: 'assistant',
          content: reply,
          meta: { kind: 'diagnosis', engine: ai.engine, advice: report.advice.length },
        });
      }
    } else {
      const result = await reviseProject(project, message);
      const reply = result.changed
        ? `${result.note}\n\nNeu erzeugt: ${actionSummaryText(result.created)}.` +
          (result.superseded ? ` ${result.superseded} ältere Aktion(en) wurden ersetzt.` : '') +
          '\n\nBitte freigeben, damit Studio die Änderungen übernimmt.'
        : result.note;
      store.addMessage(project.id, {
        role: 'assistant',
        content: reply,
        meta: { kind: result.changed ? 'revision' : 'noop', actions: result.created.length },
      });
    }

    res.json({
      project: projectView(store.getProject(project.id)),
      messages: store.listMessages(project.id).slice(-40),
      actions: store.listActions(project.id, 'pending').map((a) => ({ id: a.id, type: a.type, summary: a.summary })),
    });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- Aktionen ------------------------------ */

app.get('/api/projects/:id/actions', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  const status = req.query.status ? String(req.query.status) : null;
  res.json({ actions: store.listActions(project.id, status).slice(-300).reverse(), counts: countActions(project.id) });
});

app.post('/api/projects/:id/actions/approve', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  const count = store.approveActions(project.id, ids);
  store.touchProject(project.id);
  res.json({ approved: count, counts: countActions(project.id), pluginOnline: pluginOnline(project) });
});

app.post('/api/projects/:id/actions/reject', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  const count = store.rejectActions(project.id, ids);
  res.json({ rejected: count, counts: countActions(project.id) });
});

/* --------------------------------- Skripte ------------------------------ */

app.get('/api/projects/:id/scripts', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  if (!project.blueprint) return res.json({ scripts: [] });
  res.json({ scripts: scriptOverview(project.blueprint) });
});

app.get('/api/projects/:id/scripts/:name', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });
  if (!project.blueprint) return res.status(404).json({ error: 'Noch kein Spiel generiert' });
  const script = getScript(project.blueprint, req.params.name);
  if (!script) return res.status(404).json({ error: 'Skript nicht gefunden' });
  res.json(script);
});

/* -------------------------------- Analyse ------------------------------- */

app.post('/api/projects/:id/analyze', async (req, res, next) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Projekt nicht gefunden' });
    const { url = '', notes = '', screenshots = [] } = req.body || {};
    if (!url && !String(notes).trim() && (!Array.isArray(screenshots) || screenshots.length === 0)) {
      return res.status(400).json({ error: 'Bitte Link, Notizen oder Screenshot angeben' });
    }
    const result = await analyzeReference({
      url: String(url).slice(0, 500),
      notes: String(notes).slice(0, 4000),
      screenshots: Array.isArray(screenshots) ? screenshots.slice(0, 4) : [],
      projectName: project.name,
    });
    const superseded = supersedeOpenActions(project.id, 'Durch Analyse ersetzt');
    const actions = compileBlueprint(result.blueprint, { mode: 'full' });
    const created = store.addActions(project.id, actions);
    store.updateProject(project.id, { blueprint: result.blueprint, engine: result.engine });
    const analysis = {
      id: crypto.randomUUID(),
      projectId: project.id,
      createdAt: new Date().toISOString(),
      ...result.analysis,
      engine: result.engine,
      actions: created.length,
    };
    store.addAnalysis(project.id, analysis);
    store.addMessage(project.id, {
      role: 'assistant',
      content:
        `Analyse abgeschlossen (${result.engine === 'ki' ? 'KI' : 'Vorlagen-Engine'}).\n` +
        `Erkannte Mechaniken: ${result.analysis.mechanics.join(', ')}.\n` +
        `Rechtlicher Hinweis: ${result.analysis.legality}\n` +
        `Grenzen: ${result.analysis.limitations}\n\n` +
        `Daraus erzeugt: ${actionSummaryText(created)}. Bitte freigeben.`,
      meta: { kind: 'analysis', engine: result.engine, actions: created.length },
    });
    res.json({
      analysis,
      project: projectView(store.getProject(project.id)),
      superseded,
      actions: store.listActions(project.id, 'pending').length,
    });
  } catch (err) {
    next(err);
  }
});

/* --------------------------- Studio-Plugin-Bridge ----------------------- */

app.post('/api/plugin/poll', (req, res) => {
  const { token, placeName, placeId, studioVersion } = req.body || {};
  const project = store.findProjectByToken(token);
  if (!project) return res.status(401).json({ error: 'Unbekanntes Projekt-Token' });

  project.plugin = {
    ...project.plugin,
    online: true,
    lastSeen: new Date().toISOString(),
    placeName: placeName || project.plugin?.placeName || null,
    placeId: placeId || project.plugin?.placeId || null,
    studioVersion: studioVersion || project.plugin?.studioVersion || null,
  };
  store.updateProject(project.id, { plugin: project.plugin });

  const actions = store.claimApprovedActions(project.id).map((action) => ({
    id: action.id,
    type: action.type,
    summary: action.summary,
    payload: action.payload,
  }));

  res.json({
    project: { id: project.id, name: project.name },
    actions,
    pending: countActions(project.id).pending,
  });
});

app.post('/api/plugin/report', (req, res) => {
  const { token, results } = req.body || {};
  const project = store.findProjectByToken(token);
  if (!project) return res.status(401).json({ error: 'Unbekanntes Projekt-Token' });
  if (!Array.isArray(results)) return res.status(400).json({ error: 'results fehlt' });

  let applied = 0;
  let failed = 0;
  const failures = [];
  for (const item of results.slice(0, 200)) {
    const action = store.getAction(item.id);
    if (!action || action.projectId !== project.id) continue;
    if (item.ok) {
      applied += 1;
      store.updateAction(action.id, { status: 'done', result: String(item.message || 'OK'), error: null });
    } else {
      failed += 1;
      failures.push(String(item.message || 'Fehler'));
      store.updateAction(action.id, { status: 'failed', error: String(item.message || 'Fehler') });
    }
  }
  store.touchProject(project.id);
  if (applied || failed) {
    store.addMessage(project.id, {
      role: 'assistant',
      content:
        `Studio hat ${applied} Aktion(en) ausgeführt` +
        (failed ? ` und ${failed} gemeldet als fehlgeschlagen:\n• ${failures.slice(0, 6).join('\n• ')}` : '.') +
        (failed ? '\nSag "behebe die Fehler", damit ich die Ursache prüfe.' : ' Öffne Play in Studio und teste das Spiel.'),
      meta: { kind: 'studio-report', applied, failed },
    });
  }
  res.json({ ok: true, applied, failed, counts: countActions(project.id) });
});

app.post('/api/plugin/scan', (req, res) => {
  const { token, scan } = req.body || {};
  const project = store.findProjectByToken(token);
  if (!project) return res.status(401).json({ error: 'Unbekanntes Projekt-Token' });
  if (!scan || typeof scan !== 'object') return res.status(400).json({ error: 'scan fehlt' });

  const trimmed = {
    placeName: String(scan.placeName || 'Unbenannt').slice(0, 120),
    placeId: Number(scan.placeId) || 0,
    parts: Number(scan.parts) || 0,
    models: Number(scan.models) || 0,
    unanchoredParts: Number(scan.unanchoredParts) || 0,
    scripts: Array.isArray(scan.scripts) ? scan.scripts.slice(0, 250) : [],
    logs: Array.isArray(scan.logs) ? scan.logs.slice(-120) : [],
    at: new Date().toISOString(),
  };
  const report = analyzeScan(trimmed);

  project.plugin = {
    ...project.plugin,
    online: true,
    lastSeen: new Date().toISOString(),
    placeName: trimmed.placeName,
    placeId: trimmed.placeId,
    lastScan: trimmed.at,
    snapshot: trimmed,
    advice: report.advice,
  };
  store.updateProject(project.id, { plugin: project.plugin });
  store.addMessage(project.id, {
    role: 'assistant',
    content:
      `Scan empfangen: ${trimmed.parts} Teile, ${trimmed.models} Modelle, ${trimmed.scripts.length} Skripte, ` +
      `${trimmed.logs.length} Log-Meldungen.\n` +
      (report.advice.length
        ? `Hinweise:\n• ${report.advice.slice(0, 6).map((a) => `${a.title}: ${a.detail}`).join('\n• ')}`
        : 'Keine klaren Fehler in den Log-Meldungen gefunden.'),
    meta: { kind: 'scan', advice: report.advice.length },
  });

  res.json({ ok: true, advice: report.advice, summary: report.summary });
});

/* ------------------------------ Plugin-Datei ---------------------------- */

app.get('/plugin/RobloxStudioAI.lua', (req, res) => {
  if (!fs.existsSync(PLUGIN_FILE)) return res.status(404).type('text/plain').send('-- Plugin-Datei fehlt');
  const base = `${req.protocol}://${req.get('host')}`;
  const source = fs.readFileSync(PLUGIN_FILE, 'utf8').replace('__SERVER_URL__', base);
  res.type('text/plain; charset=utf-8').send(source);
});

/* -------------------------------- Frontend ------------------------------ */

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api|\/plugin|\/healthz).*/, (req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Nicht gefunden' });
});

app.use((err, req, res, next) => {
  console.error('[server]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Serverfehler' });
});

const PORT = Number(process.env.PORT || 3000);
const server = app.listen(PORT, '0.0.0.0', () => {
  const status = aiStatus();
  console.log(`[Roblox Studio AI] läuft auf http://0.0.0.0:${PORT} (Modus: ${status.mode}${status.model ? `, ${status.model}` : ''})`);
});

function shutdown(signal) {
  console.log(`[Roblox Studio AI] ${signal} empfangen, speichere Daten ...`);
  try {
    store.flush();
  } catch (err) {
    console.error('[Roblox Studio AI] Speichern fehlgeschlagen:', err.message);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
