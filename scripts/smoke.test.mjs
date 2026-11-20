/**
 * End-to-End-Smoke-Test ohne Mocking: startet den echten Server auf einem freien Port,
 * erzeugt ein Projekt, generiert ein Spiel, gibt Aktionen frei, spielt das Studio-Plugin
 * (poll + report), liest ein Luau-Skript, sendet einen Scan und eine Änderungsanfrage.
 *
 * Ausführen: npm test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4300 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rsa-test-'));

let child;
let projectId;
let token;

async function call(method, route, body) {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, APP_PASSWORD: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) break;
    } catch {
      /* Server startet noch */
    }
    if (Date.now() > deadline) throw new Error('Server ist nicht gestartet');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
});

after(() => {
  if (child) child.kill('SIGKILL');
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('Status meldet Betriebsart und Plugin-Verfügbarkeit', async () => {
  const res = await call('GET', '/api/status');
  assert.equal(res.status, 200);
  assert.ok(['ki', 'vorlage'].includes(res.json.ai.mode));
  assert.equal(res.json.plugin.available, true);
  assert.equal(typeof res.json.ai.note, 'string');
});

test('Projekt anlegen und Spiel generieren erzeugt echte Aktionen', async () => {
  const res = await call('POST', '/api/projects', {
    name: 'Anime Simulator Test',
    prompt:
      'Erstelle mir einen Anime-Simulator mit einer riesigen Map, verschiedenen Inseln, Pets, Shops, Quests, Bossen und einem Levelsystem.',
    generate: true,
  });
  assert.equal(res.status, 201);
  projectId = res.json.project.id;
  token = res.json.project.token;
  assert.ok(projectId && token, 'Projekt-ID und Token vorhanden');
  assert.ok(res.json.actions > 0, 'Aktionen wurden erzeugt');
  assert.ok(res.json.project.counts.islands >= 3, 'mehrere Inseln geplant');
  assert.ok(res.json.project.counts.pets >= 6, 'Pets geplant');
  assert.ok(res.json.project.counts.bosses >= 1, 'mindestens ein Boss');
  assert.ok(res.json.project.scripts.length >= 5, 'Luau-Skripte vorhanden');
});

test('Detailansicht liefert Chatverlauf, Aktionen und Skriptübersicht', async () => {
  const res = await call('GET', `/api/projects/${projectId}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.project.id, projectId);
  assert.ok(res.json.actions.length > 0);
  assert.ok(res.json.actions.every((a) => a.status === 'pending'), 'nichts ohne Freigabe ausgeführt');
  assert.ok(res.json.messages.length >= 1);
  assert.ok(res.json.project.actionCounts.pending > 0);
});

test('Plugin darf ohne Freigabe keine Aktionen abholen', async () => {
  const res = await call('POST', '/api/plugin/poll', { token, placeName: 'TestPlace' });
  assert.equal(res.status, 200);
  assert.equal(res.json.actions.length, 0, 'keine unbestätigten Aktionen für Studio');
  assert.equal(res.json.project.name, 'Anime Simulator Test');
});

test('Freigabe gibt Aktionen für das Plugin frei, Poll liefert sie', async () => {
  const approve = await call('POST', `/api/projects/${projectId}/actions/approve`, {});
  assert.equal(approve.status, 200);
  assert.ok(approve.json.approved > 0);

  const poll = await call('POST', '/api/plugin/poll', {
    token,
    placeName: 'TestPlace',
    placeId: 123,
    studioVersion: 'test',
  });
  assert.equal(poll.status, 200);
  assert.ok(poll.json.actions.length > 0, 'Plugin erhält freigegebene Aktionen');
  const types = new Set(poll.json.actions.map((a) => a.type));
  assert.ok(types.has('createTree'), 'Objektbau enthalten');
  assert.ok(types.has('createScript'), 'Skript-Erzeugung enthalten');
  const script = poll.json.actions.find((a) => a.type === 'createScript');
  assert.ok(script.payload.source.includes('RobloxStudioAI') || script.payload.source.length > 200);
  assert.ok(script.payload.path.endsWith('.server') || script.payload.path.endsWith('.client') || script.payload.path.includes('GameConfig'));

  const second = await call('POST', '/api/plugin/poll', { token });
  assert.equal(second.json.actions.length, 0, 'Aktionen werden nur einmal ausgegeben');

  const ids = poll.json.actions.map((a) => ({ id: a.id, ok: true, message: 'ausgeführt' }));
  const report = await call('POST', '/api/plugin/report', { token, results: ids });
  assert.equal(report.status, 200);
  assert.equal(report.json.failed, 0);
  assert.ok(report.json.applied > 0);

  const detail = await call('GET', `/api/projects/${projectId}`);
  assert.ok(detail.json.project.actionCounts.done > 0, 'Status wird als ausgeführt gespeichert');
});

test('Skripte sind als Luau-Quelltext abrufbar', async () => {
  const overview = await call('GET', `/api/projects/${projectId}/scripts`);
  assert.equal(overview.status, 200);
  assert.ok(overview.json.scripts.length >= 5);

  const name = overview.json.scripts[0].name;
  const res = await call('GET', `/api/projects/${projectId}/scripts/${name}`);
  assert.equal(res.status, 200);
  assert.ok(res.json.source.length > 200, 'echter Quelltext');
  assert.ok(/local |function |game:GetService/.test(res.json.source), 'gültiger Luau-Aufbau');
});

test('Studio-Scan wird ausgewertet und liefert Hinweise', async () => {
  const res = await call('POST', '/api/plugin/scan', {
    token,
    scan: {
      placeName: 'TestPlace',
      parts: 42,
      models: 3,
      unanchoredParts: 7,
      scripts: [{ name: 'Main', path: 'ServerScriptService.Main' }],
      logs: [
        'Infinite yield possible on Workspace.Enemies',
        'ServerScriptService.Main:12: attempt to index nil with Coins',
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.advice));
  assert.ok(res.json.advice.length > 0, 'Hinweise aus Log-Meldungen');

  const chat = await call('POST', `/api/projects/${projectId}/chat`, {
    message: 'Behebe die Fehler in meinem Spiel',
  });
  assert.equal(chat.status, 200);
  const last = chat.json.messages[chat.json.messages.length - 1];
  assert.equal(last.role, 'assistant');
  assert.match(last.content, /Scan|Hinweis/i);
});

test('Chat-Änderung erzeugt neue Aktionen für dasselbe Projekt', async () => {
  const before = await call('GET', `/api/projects/${projectId}`);
  const res = await call('POST', `/api/projects/${projectId}/chat`, {
    message: 'Füge eine neue Insel hinzu und erstelle zehn neue Pets',
  });
  assert.equal(res.status, 200);
  assert.ok(res.json.messages.length > before.json.messages.length);
  assert.ok(res.json.actions.length > 0, 'Änderung erzeugt freigabepflichtige Aktionen');

  const detail = await call('GET', `/api/projects/${projectId}`);
  assert.ok(detail.json.project.counts.islands > before.json.project.counts.islands, 'Insel kam hinzu');
  assert.ok(detail.json.project.counts.pets > before.json.project.counts.pets, 'Pets kamen hinzu');
});

test('Projekte sind unbegrenzt: viele Projekte parallel speicherbar', async () => {
  const created = [];
  for (let i = 0; i < 7; i += 1) {
    const res = await call('POST', '/api/projects', {
      name: `Projekt ${i}`,
      prompt: 'Tower Defense mit Wellen und Boss',
      generate: false,
    });
    assert.equal(res.status, 201);
    created.push(res.json.project.id);
  }
  const list = await call('GET', '/api/projects');
  assert.equal(list.status, 200);
  assert.ok(list.json.projects.length >= 8, 'alle Projekte bleiben erhalten');
  for (const id of created) {
    const detail = await call('GET', `/api/projects/${id}`);
    assert.equal(detail.status, 200);
  }
});

test('Plugin-Datei wird mit Server-URL ausgeliefert', async () => {
  const res = await call('GET', '/plugin/RobloxStudioAI.lua');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes(BASE), 'Server-URL ist eingesetzt');
  assert.ok(res.text.includes('HttpService'), 'nutzt HttpService');
});

test('Unbekanntes Token wird abgelehnt', async () => {
  const res = await call('POST', '/api/plugin/poll', { token: 'ungueltig' });
  assert.equal(res.status, 401);
});

test('Oberfläche wird ausgeliefert', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Roblox Studio AI'));
  assert.ok(html.includes('/assets/'), 'gebauter Client ist eingebunden');
});
