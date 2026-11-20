import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = { version: 1, projects: [], messages: [], actions: [], analyses: [] };

let db = null;
let saveTimer = null;

function ensure() {
  if (db) return db;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = { ...structuredClone(EMPTY), ...raw };
    } else {
      db = structuredClone(EMPTY);
    }
  } catch (err) {
    console.error('[store] Konnte Datenbank nicht laden, starte leer:', err.message);
    db = structuredClone(EMPTY);
  }
  for (const key of Object.keys(EMPTY)) {
    if (key === 'version') continue;
    if (!Array.isArray(db[key])) db[key] = [];
  }
  return db;
}

function persist() {
  const data = ensure();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('[store] Speichern fehlgeschlagen:', err.message);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist();
  }, 40);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

export function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  persist();
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

/** Entfernt die Metafelder einer Compiler-Aktion, damit nur Nutzdaten bleiben. */
function stripMeta(action) {
  const { type, summary, requiresConfirmation, ...payload } = action || {};
  return payload;
}

export function newToken() {
  return `rsa_${crypto.randomBytes(24).toString('hex')}`;
}

/* ------------------------------- Projekte ------------------------------- */

export function listProjects() {
  const data = ensure();
  return data.projects
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((project) => ({
      id: project.id,
      name: project.name,
      prompt: project.prompt,
      engine: project.engine,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      pluginOnline: Boolean(project.plugin?.online),
      pluginLastSeen: project.plugin?.lastSeen || null,
      placeName: project.plugin?.placeName || null,
      counts: {
        pets: project.blueprint?.pets?.length || 0,
        islands: project.blueprint?.world?.islands?.length || 0,
        enemies: project.blueprint?.enemies?.length || 0,
        quests: project.blueprint?.quests?.length || 0,
      },
      pendingActions: data.actions.filter((a) => a.projectId === project.id && a.status === 'pending').length,
    }));
}

export function getProject(projectId) {
  const data = ensure();
  return data.projects.find((p) => p.id === projectId) || null;
}

export function findProjectByToken(token) {
  if (!token) return null;
  const data = ensure();
  return data.projects.find((p) => p.token === token) || null;
}

export function createProject({ name, prompt = '', engine = 'template' } = {}) {
  const data = ensure();
  const project = {
    id: id(),
    name: (name || 'Neues Roblox-Projekt').slice(0, 120),
    prompt,
    engine,
    token: newToken(),
    createdAt: now(),
    updatedAt: now(),
    blueprint: null,
    settings: { autoApprove: false },
    plugin: { online: false, lastSeen: null, placeName: null, placeId: null, studioVersion: null, snapshot: null },
  };
  data.projects.push(project);
  scheduleSave();
  return project;
}

export function updateProject(projectId, patch = {}) {
  const project = getProject(projectId);
  if (!project) return null;
  Object.assign(project, patch, { updatedAt: now() });
  scheduleSave();
  return project;
}

export function touchProject(projectId) {
  const project = getProject(projectId);
  if (!project) return null;
  project.updatedAt = now();
  scheduleSave();
  return project;
}

export function deleteProject(projectId) {
  const data = ensure();
  const before = data.projects.length;
  data.projects = data.projects.filter((p) => p.id !== projectId);
  data.messages = data.messages.filter((m) => m.projectId !== projectId);
  data.actions = data.actions.filter((a) => a.projectId !== projectId);
  data.analyses = data.analyses.filter((a) => a.projectId !== projectId);
  scheduleSave();
  return data.projects.length < before;
}

/* ------------------------------- Analysen ------------------------------- */

export function addAnalysis(analysis) {
  const data = ensure();
  data.analyses.push(analysis);
  scheduleSave();
  return analysis;
}

export function listAnalyses(projectId, limit = 20) {
  const data = ensure();
  return data.analyses.filter((a) => a.projectId === projectId).slice(-limit).reverse();
}

/* -------------------------------- Chat --------------------------------- */

export function addMessage(projectId, { role, content, meta = null }) {
  const data = ensure();
  const message = { id: id(), projectId, role, content, meta, createdAt: now() };
  data.messages.push(message);
  scheduleSave();
  return message;
}

export function listMessages(projectId, limit = 200) {
  const data = ensure();
  return data.messages.filter((m) => m.projectId === projectId).slice(-limit);
}

/* ------------------------------ Aktionen ------------------------------- */

export function addActions(projectId, actions) {
  const data = ensure();
  const created = actions.map((action) => ({
    id: id(),
    projectId,
    type: action.type,
    summary: action.summary || action.type,
    // Der Compiler liefert die Nutzdaten direkt auf der Aktionsebene.
    // Für das Plugin werden sie gebündelt unter payload abgelegt.
    payload: action.payload || stripMeta(action),
    status: action.requiresConfirmation === false ? 'approved' : 'pending',
    requiresConfirmation: action.requiresConfirmation !== false,
    createdAt: now(),
    updatedAt: now(),
    attempts: 0,
    result: null,
    error: null,
    deliveredAt: null,
  }));
  data.actions.push(...created);
  scheduleSave();
  return created;
}

export function listActions(projectId, status = null, limit = 400) {
  const data = ensure();
  let items = data.actions.filter((a) => a.projectId === projectId);
  if (status) items = items.filter((a) => a.status === status);
  return items.slice(-limit);
}

export function getAction(actionId) {
  const data = ensure();
  return data.actions.find((a) => a.id === actionId) || null;
}

export function updateAction(actionId, patch) {
  const action = getAction(actionId);
  if (!action) return null;
  Object.assign(action, patch, { updatedAt: now() });
  scheduleSave();
  return action;
}

export function approveActions(projectId, actionIds = null) {
  const data = ensure();
  const targets = data.actions.filter(
    (a) => a.projectId === projectId && a.status === 'pending' && (!actionIds || actionIds.includes(a.id)),
  );
  for (const action of targets) {
    action.status = 'approved';
    action.updatedAt = now();
  }
  scheduleSave();
  return targets.length;
}

export function rejectActions(projectId, actionIds = null) {
  const data = ensure();
  const targets = data.actions.filter(
    (a) => a.projectId === projectId && a.status === 'pending' && (!actionIds || actionIds.includes(a.id)),
  );
  for (const action of targets) {
    action.status = 'rejected';
    action.updatedAt = now();
  }
  scheduleSave();
  return targets.length;
}

/**
 * Holt freigegebene Aktionen für das Plugin und markiert sie als "delivered".
 * Bereits gelieferte, aber seit >45s nicht bestätigte Aktionen werden erneut
 * zugestellt, damit ein Studio-Neustart keine Aktion verschluckt.
 */
export function claimApprovedActions(projectId, limit = 12) {
  const data = ensure();
  const cutoff = Date.now() - 45_000;
  const stale = (action) => action.status === 'delivered' && new Date(action.deliveredAt || 0).getTime() < cutoff;
  const ready = data.actions
    .filter((a) => a.projectId === projectId && (a.status === 'approved' || stale(a)))
    .slice(0, limit);
  for (const action of ready) {
    action.status = 'delivered';
    action.deliveredAt = now();
    action.attempts = (action.attempts || 0) + 1;
    action.updatedAt = now();
  }
  if (ready.length) scheduleSave();
  return ready;
}

/* ------------------------------ Analysen ------------------------------- */

export function addAnalysis(projectId, analysis) {
  const data = ensure();
  const entry = { id: id(), projectId, createdAt: now(), ...analysis };
  data.analyses.push(entry);
  scheduleSave();
  return entry;
}

export function listAnalyses(projectId) {
  const data = ensure();
  return data.analyses.filter((a) => a.projectId === projectId).slice(-20);
}

export function stats() {
  const data = ensure();
  return {
    projects: data.projects.length,
    messages: data.messages.length,
    actions: data.actions.length,
    pending: data.actions.filter((a) => a.status === 'pending').length,
  };
}

ensure();
