import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  ApiError,
  absoluteUrl,
  pluginDownloadUrl,
  setKey,
} from './api';
import type {
  Analysis,
  ChatMessage,
  Project,
  ProjectDetail,
  ProjectListItem,
  ScriptSource,
  StatusResponse,
  StudioAction,
} from './types';

type Tab = 'chat' | 'actions' | 'studio' | 'analyze' | 'data';

const EXAMPLES = [
  'Erstelle mir einen Anime-Simulator mit einer riesigen Map, verschiedenen Inseln, Pets, Shops, Quests, Bossen und einem Levelsystem.',
  'Baue ein Tower-Defense-Spiel mit 5 Inseln, Wellen von Gegnern, einem Boss alle 5 Wellen und einem Shop für Upgrades.',
  'Erstelle ein Fantasy-Rollenspiel mit Dorf, Wald, Höhlen, NPCs mit Dialogen, Quests und einem Endboss.',
];

function timeAgo(iso: string | null): string {
  if (!iso) return 'nie';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return 'unbekannt';
  if (diff < 60_000) return `vor ${Math.max(1, Math.round(diff / 1000))} s`;
  if (diff < 3_600_000) return `vor ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `vor ${Math.round(diff / 3_600_000)} h`;
  return `vor ${Math.round(diff / 86_400_000)} Tagen`;
}

function actionTone(status: StudioAction['status']): string {
  switch (status) {
    case 'pending':
      return 'tone-warn';
    case 'approved':
      return 'tone-info';
    case 'delivered':
      return 'tone-info';
    case 'done':
      return 'tone-ok';
    case 'failed':
      return 'tone-bad';
    default:
      return 'tone-muted';
  }
}

const ACTION_LABEL: Record<string, string> = {
  deleteInstance: 'Aufräumen',
  createTree: 'Objekt bauen',
  createScript: 'Luau-Skript',
  setProperties: 'Eigenschaft',
  selectInstance: 'Auswahl',
  delete: 'Löschen',
};

export default function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [scriptView, setScriptView] = useState<ScriptSource | null>(null);

  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  const loadProjects = useCallback(async () => {
    const data = await api.listProjects();
    setProjects(data.projects);
    return data.projects;
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    const data = await api.getProject(id);
    setDetail(data);
    return data;
  }, []);

  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      if (err.requiresKey || err.status === 401) setNeedsKey(true);
      setError(err.message);
    } else {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    }
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const [statusData, projectData] = await Promise.all([api.status(), api.listProjects()]);
      setStatus(statusData);
      setProjects(projectData.projects);
      setNeedsKey(false);
      if (projectData.projects.length > 0) {
        setActiveId((current) => current ?? projectData.projects[0].id);
      }
    } catch (err) {
      handleError(err);
    }
  }, [handleError]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    refreshDetail(activeId).catch((err) => {
      if (!cancelled) handleError(err);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, refreshDetail, handleError]);

  // Studio-Status regelmäßig aktualisieren, solange die relevanten Tabs offen sind
  useEffect(() => {
    if (!activeId || (tab !== 'actions' && tab !== 'studio')) return;
    const timer = setInterval(() => {
      refreshDetail(activeId).catch(() => undefined);
      loadProjects().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [activeId, tab, refreshDetail, loadProjects]);

  const createProject = async (withGenerate: boolean) => {
    if (!newName.trim() && !newPrompt.trim()) {
      setError('Bitte Projektname oder Spielbeschreibung eingeben');
      return;
    }
    setBusy('create');
    setError(null);
    try {
      const created = await api.createProject({
        name: newName.trim() || newPrompt.trim().slice(0, 60),
        prompt: newPrompt.trim(),
        generate: withGenerate && newPrompt.trim().length > 0,
      });
      setNewName('');
      setNewPrompt('');
      await loadProjects();
      setActiveId(created.project.id);
      setTab('chat');
      await refreshDetail(created.project.id);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const deleteProject = async (id: string) => {
    if (!window.confirm('Projekt wirklich löschen? Alle Aktionen und Chatverläufe werden entfernt.')) return;
    try {
      await api.deleteProject(id);
      const remaining = await loadProjects();
      if (activeId === id) {
        setActiveId(remaining[0]?.id ?? null);
        setDetail(null);
      }
    } catch (err) {
      handleError(err);
    }
  };

  const sendChat = async (message: string) => {
    if (!activeId || !message.trim()) return;
    setBusy('chat');
    setError(null);
    try {
      await api.chat(activeId, message.trim());
      await refreshDetail(activeId);
      await loadProjects();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const approve = async (ids?: string[]) => {
    if (!activeId) return;
    setBusy('approve');
    try {
      await api.approve(activeId, ids);
      await refreshDetail(activeId);
      await loadProjects();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const reject = async (ids?: string[]) => {
    if (!activeId) return;
    setBusy('reject');
    try {
      await api.reject(activeId, ids);
      await refreshDetail(activeId);
      await loadProjects();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const openScript = async (name: string) => {
    if (!activeId) return;
    try {
      setScriptView(await api.script(activeId, name));
    } catch (err) {
      handleError(err);
    }
  };

  const analyze = async (payload: { url: string; notes: string; screenshots: string[] }) => {
    if (!activeId) return;
    setBusy('analyze');
    setError(null);
    try {
      await api.analyze(activeId, payload);
      await refreshDetail(activeId);
      await loadProjects();
      setTab('actions');
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async () => {
    setKey(keyInput.trim());
    setNeedsKey(false);
    setError(null);
    await bootstrap();
  };

  const project = detail?.project ?? null;

  if (needsKey) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>Roblox Studio AI</h1>
          <p>Diese Instanz ist mit einem Zugriffscode geschützt. Bitte den Code aus den Server-Einstellungen eingeben.</p>
          <input
            type="password"
            value={keyInput}
            placeholder="Zugriffscode"
            onChange={(event) => setKeyInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveKey();
            }}
          />
          <button type="button" className="btn primary" onClick={() => void saveKey()}>
            Öffnen
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">RS</div>
          <div>
            <strong>Roblox Studio AI</strong>
            <span>Spiele beschreiben, bauen lassen</span>
          </div>
        </div>

        {status && (
          <div className={`mode-chip ${status.ai.mode === 'ki' ? 'ki' : 'template'}`}>
            <span className="dot" />
            {status.ai.mode === 'ki' ? `KI-Modus · ${status.ai.model}` : 'Vorlagen-Modus (ohne API-Key)'}
          </div>
        )}

        <div className="new-project">
          <h2>Neues Projekt</h2>
          <input
            value={newName}
            placeholder="Projektname (optional)"
            onChange={(event) => setNewName(event.target.value)}
          />
          <textarea
            value={newPrompt}
            placeholder="Welches Spiel soll gebaut werden?"
            rows={3}
            onChange={(event) => setNewPrompt(event.target.value)}
          />
          <div className="row">
            <button
              type="button"
              className="btn primary"
              disabled={busy === 'create'}
              onClick={() => void createProject(true)}
            >
              {busy === 'create' ? 'Erzeuge …' : 'Erstellen & generieren'}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy === 'create'}
              onClick={() => void createProject(false)}
            >
              Nur anlegen
            </button>
          </div>
        </div>

        <div className="project-list">
          <div className="project-list-head">
            <h2>Meine Projekte</h2>
            <span className="pill">{projects.length}</span>
          </div>
          {projects.length === 0 && <p className="muted small">Noch keine Projekte. Beliebig viele möglich.</p>}
          {projects.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`project-item ${item.id === activeId ? 'active' : ''}`}
              onClick={() => {
                setActiveId(item.id);
                setTab('chat');
              }}
            >
              <span className="project-name">{item.name}</span>
              <span className="project-meta">
                {item.counts.islands} Inseln · {item.counts.pets} Pets · {item.counts.enemies} Gegner
              </span>
              <span className="project-foot">
                <span className={`dot ${item.pluginOnline ? 'online' : 'offline'}`} />
                {item.pluginOnline ? 'Studio verbunden' : `Studio ${timeAgo(item.pluginLastSeen)}`}
                {item.pendingActions > 0 && <span className="badge">{item.pendingActions} offen</span>}
              </span>
            </button>
          ))}
        </div>

        {status && (
          <div className="sidebar-foot">
            <p className="small muted">{status.ai.note}</p>
            <p className="small muted">
              Speicherung: {status.storage.kind}
              {status.storage.persistentDisk ? ' (dauerhaft)' : ' (ohne dauerhafte Festplatte)'}
            </p>
          </div>
        )}
      </aside>

      <main className="main">
        {error && (
          <div className="banner error">
            <span>{error}</span>
            <button type="button" className="btn tiny ghost" onClick={() => setError(null)}>
              schließen
            </button>
          </div>
        )}

        {!project && (
          <div className="empty">
            <h1>Beschreibe dein Roblox-Spiel</h1>
            <p>
              Die Anwendung erzeugt daraus einen vollständigen Spielplan und echte Studio-Aktionen:
              Inseln, Gebäude, NPCs, Gegner, Pets, Shop, Quests, Levelsystem, UI und Luau-Skripte.
              Freigegebene Aktionen baut das Studio-Plugin in dein Spiel ein.
            </p>
            <div className="examples">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" className="example" onClick={() => setNewPrompt(example)}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {project && detail && (
          <>
            <header className="topbar">
              <div>
                <h1>{project.name}</h1>
                <p className="muted small">
                  {project.engine === 'ki' ? 'KI-generierter Blueprint' : 'Vorlagen-Blueprint'} · zuletzt{' '}
                  {timeAgo(project.updatedAt)} · {project.counts.islands} Inseln, {project.counts.pets} Pets,{' '}
                  {project.counts.enemies} Gegner ({project.counts.bosses} Bosse), {project.counts.quests} Quests
                </p>
              </div>
              <div className="topbar-right">
                <span className={`status-pill ${project.plugin.online ? 'online' : 'offline'}`}>
                  <span className="dot" />
                  {project.plugin.online
                    ? `Studio verbunden${project.plugin.placeName ? ` · ${project.plugin.placeName}` : ''}`
                    : 'Studio nicht verbunden'}
                </span>
                <button
                  type="button"
                  className="btn tiny ghost"
                  onClick={() => void deleteProject(project.id)}
                >
                  Projekt löschen
                </button>
              </div>
            </header>

            <nav className="tabs">
              {(
                [
                  ['chat', 'Chat & Generator'],
                  ['actions', `Aktionen${project.actionCounts.pending ? ` (${project.actionCounts.pending})` : ''}`],
                  ['studio', 'Studio-Verbindung'],
                  ['analyze', 'Spiel-Analyse'],
                  ['data', 'Projektdaten'],
                ] as [Tab, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`tab ${tab === value ? 'active' : ''}`}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </nav>

            {tab === 'chat' && (
              <ChatPanel
                messages={detail.messages}
                busy={busy === 'chat'}
                onSend={sendChat}
                summary={project.summary}
              />
            )}

            {tab === 'actions' && (
              <ActionsPanel
                actions={detail.actions}
                counts={project.actionCounts}
                busy={busy}
                pluginOnline={project.plugin.online}
                onApprove={approve}
                onReject={reject}
                onOpenScript={openScript}
              />
            )}

            {tab === 'studio' && (
              <StudioPanel project={project} status={status} onRefresh={() => void refreshDetail(project.id)} />
            )}

            {tab === 'analyze' && (
              <AnalyzePanel analyses={detail.analyses} busy={busy === 'analyze'} onAnalyze={analyze} />
            )}

            {tab === 'data' && <DataPanel project={project} onOpenScript={openScript} />}
          </>
        )}
      </main>

      {scriptView && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal-card">
            <header>
              <div>
                <strong>{scriptView.name}</strong>
                <p className="muted small">
                  {scriptView.type} · {scriptView.path}
                </p>
              </div>
              <button type="button" className="btn tiny ghost" onClick={() => setScriptView(null)}>
                schließen
              </button>
            </header>
            <pre className="code">{scriptView.source}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Chat ---------------------------------- */

function ChatPanel({
  messages,
  busy,
  onSend,
  summary,
}: {
  messages: ChatMessage[];
  busy: boolean;
  onSend: (message: string) => Promise<void>;
  summary: string | null;
}) {
  const [value, setValue] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const submit = async () => {
    const text = value.trim();
    if (!text || busy) return;
    setValue('');
    await onSend(text);
  };

  return (
    <section className="panel chat">
      {summary && <div className="summary-box">{summary}</div>}
      <div className="messages">
        {messages.length === 0 && (
          <p className="muted">
            Noch keine Nachrichten. Beschreibe oben dein Spiel oder fordere Änderungen an, z. B. „füge 3 Inseln hinzu“,
            „erstelle 10 neue Pets“ oder „behebe die Fehler in meinem Spiel“.
          </p>
        )}
        {messages.map((message) => (
          <article key={message.id} className={`bubble ${message.role}`}>
            <header>
              <span>{message.role === 'user' ? 'Du' : 'Roblox Studio AI'}</span>
              <time>{new Date(message.createdAt).toLocaleTimeString('de-DE')}</time>
            </header>
            <div className="bubble-body">{message.content}</div>
          </article>
        ))}
        {busy && <p className="muted small">Die KI arbeitet …</p>}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <textarea
          value={value}
          rows={2}
          placeholder="Änderung beschreiben, z. B. „Füge eine neue Insel mit Boss hinzu“"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
          Senden
        </button>
      </div>
    </section>
  );
}

/* ------------------------------ Aktionen -------------------------------- */

function ActionsPanel({
  actions,
  counts,
  busy,
  pluginOnline,
  onApprove,
  onReject,
  onOpenScript,
}: {
  actions: StudioAction[];
  counts: Project['actionCounts'];
  busy: string | null;
  pluginOnline: boolean;
  onApprove: (ids?: string[]) => Promise<void>;
  onReject: (ids?: string[]) => Promise<void>;
  onOpenScript: (name: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'done' | 'failed'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (filter === 'all') return actions;
    if (filter === 'pending') return actions.filter((a) => a.status === 'pending');
    if (filter === 'approved') return actions.filter((a) => a.status === 'approved' || a.status === 'delivered');
    return actions.filter((a) => a.status === filter);
  }, [actions, filter]);

  return (
    <section className="panel">
      <div className="actions-head">
        <div className="counts">
          <span className="pill warn">{counts.pending} offen</span>
          <span className="pill info">{counts.approved + counts.delivered} unterwegs</span>
          <span className="pill ok">{counts.done} ausgeführt</span>
          {counts.failed > 0 && <span className="pill bad">{counts.failed} fehlgeschlagen</span>}
          {counts.rejected > 0 && <span className="pill muted">{counts.rejected} verworfen</span>}
        </div>
        <div className="row">
          <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="all">Alle</option>
            <option value="pending">Offen</option>
            <option value="approved">Freigegeben</option>
            <option value="done">Ausgeführt</option>
            <option value="failed">Fehlgeschlagen</option>
          </select>
          <button
            type="button"
            className="btn primary"
            disabled={busy !== null || counts.pending === 0}
            onClick={() => void onApprove()}
          >
            Alle freigeben
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy !== null || counts.pending === 0}
            onClick={() => void onReject()}
          >
            Alle verwerfen
          </button>
        </div>
      </div>

      <p className="muted small">
        Nichts wird ohne deine Freigabe in Studio geändert. Nach dem Freigeben holt das Plugin die Aktionen innerhalb
        von 3 Sekunden ab.
        {!pluginOnline && counts.pending > 0 && ' Das Plugin ist aktuell nicht verbunden – die Aktionen warten dann.'}
      </p>

      {visible.length === 0 && <p className="muted">Keine Aktionen in dieser Ansicht.</p>}

      <div className="action-list">
        {visible.map((action) => {
          const payload = action.payload as Record<string, unknown>;
          const scriptName = typeof payload.path === 'string' ? payload.path.split('.').pop() : null;
          const isScript = action.type === 'createScript' && scriptName;
          return (
            <article key={action.id} className={`action ${actionTone(action.status)}`}>
              <div className="action-main">
                <div>
                  <span className="action-type">{ACTION_LABEL[action.type] || action.type}</span>
                  <p className="action-summary">{action.summary}</p>
                  <p className="muted small">
                    <span className={`pill ${actionTone(action.status)}`}>{action.status}</span>{' '}
                    {action.error ? `Fehler: ${action.error}` : action.result || ''}
                  </p>
                </div>
                <div className="action-buttons">
                  {isScript && (
                    <button type="button" className="btn tiny ghost" onClick={() => void onOpenScript(scriptName!)}>
                      Code
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn tiny ghost"
                    onClick={() => setExpanded(expanded === action.id ? null : action.id)}
                  >
                    {expanded === action.id ? 'weniger' : 'Details'}
                  </button>
                  {action.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        className="btn tiny primary"
                        disabled={busy !== null}
                        onClick={() => void onApprove([action.id])}
                      >
                        freigeben
                      </button>
                      <button
                        type="button"
                        className="btn tiny ghost"
                        disabled={busy !== null}
                        onClick={() => void onReject([action.id])}
                      >
                        verwerfen
                      </button>
                    </>
                  )}
                </div>
              </div>
              {expanded === action.id && (
                <pre className="code small-code">
                  {JSON.stringify(
                    { ...payload, source: payload.source ? `${String(payload.source).split('\n').length} Zeilen Luau` : undefined },
                    null,
                    2,
                  ).slice(0, 3000)}
                </pre>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------------- Studio-Verbindung -------------------------- */

function StudioPanel({
  project,
  status,
  onRefresh,
}: {
  project: Project;
  status: StatusResponse | null;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const baseUrl = window.location.origin;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied('Kopieren nicht erlaubt – bitte manuell markieren');
    }
  };

  return (
    <section className="panel">
      <div className="grid-2">
        <div className="card">
          <h2>1. Plugin installieren</h2>
          <p className="muted small">
            Das Plugin ist die Brücke zu Roblox Studio. Es führt ausschließlich Aktionen aus, die du in dieser App
            freigegeben hast.
          </p>
          <ol className="steps">
            <li>Datei herunterladen.</li>
            <li>In Studio: Reiter „Plugins“ → „Plugins-Ordner öffnen“.</li>
            <li>Die Datei dort ablegen (Ordner: Plugins).</li>
            <li>Roblox Studio neu starten.</li>
            <li>Werkzeugleiste „Roblox Studio AI“ öffnen.</li>
          </ol>
          <a className="btn primary" href={pluginDownloadUrl()} download="RobloxStudioAI.lua">
            Plugin herunterladen (.lua)
          </a>
          <p className="muted small">
            Falls Studio HTTP blockiert: Spiel-Einstellungen → Sicherheit → „Allow HTTP Requests“ aktivieren.
          </p>
        </div>

        <div className="card">
          <h2>2. Verbindung eintragen</h2>
          <p className="muted small">Diese zwei Werte im Plugin eintragen und „Verbinden“ drücken.</p>
          <label className="field">
            <span>Server-URL</span>
            <div className="copy-row">
              <code>{baseUrl}</code>
              <button type="button" className="btn tiny ghost" onClick={() => void copy(baseUrl, 'url')}>
                kopieren
              </button>
            </div>
          </label>
          <label className="field">
            <span>Projekt-Token (geheim halten)</span>
            <div className="copy-row">
              <code>{project.token}</code>
              <button type="button" className="btn tiny ghost" onClick={() => void copy(project.token, 'token')}>
                kopieren
              </button>
            </div>
          </label>
          {copied && <p className="muted small">{copied === 'url' ? 'URL kopiert' : copied === 'token' ? 'Token kopiert' : copied}</p>}

          <div className={`conn-state ${project.plugin.online ? 'ok' : 'warn'}`}>
            <span className="dot" />
            {project.plugin.online
              ? `Verbunden mit ${project.plugin.placeName || 'Studio'} (letzter Kontakt ${timeAgo(project.plugin.lastSeen)})`
              : `Noch keine Verbindung (letzter Kontakt ${timeAgo(project.plugin.lastSeen)})`}
          </div>
          <button type="button" className="btn ghost" onClick={onRefresh}>
            Status aktualisieren
          </button>
        </div>
      </div>

      <div className="card">
        <h2>3. Bestehendes Spiel scannen</h2>
        <p className="muted small">
          Im Plugin „Projekt scannen & Fehler senden“ drücken. Die App wertet dann Struktur und Log-Meldungen aus und
          schlägt konkrete Korrekturen vor.
        </p>
        {project.plugin.snapshot ? (
          <ul className="scan-list">
            <li>Ort: {project.plugin.snapshot.placeName}</li>
            <li>{project.plugin.snapshot.parts} Teile, davon {project.plugin.snapshot.unanchoredParts} nicht verankert</li>
            <li>{project.plugin.snapshot.models} Modelle</li>
            <li>{project.plugin.snapshot.scripts} Skripte im Scan</li>
            <li>{project.plugin.snapshot.logs} Fehler-/Warnmeldungen</li>
            <li>Letzter Scan: {timeAgo(project.plugin.lastScan)}</li>
          </ul>
        ) : (
          <p className="muted small">Noch kein Scan vorhanden.</p>
        )}
        <p className="muted small">
          Für die Fehlerauswertung im Chat einfach schreiben: „Behebe die Fehler in meinem Spiel“.
        </p>
      </div>

      {status && (
        <div className="card">
          <h2>Was tatsächlich funktioniert</h2>
          <ul className="scan-list">
            <li>Projekte: unbegrenzt anlegen, speichern, wieder öffnen (JSON-Datei auf dem Server).</li>
            <li>Generierung: Map, Inseln, Gebäude, NPCs, Gegner, Bosse, Pets, Shop, Quests, Levelsystem, UI, Luau-Skripte.</li>
            <li>Studio-Bridge: Polling, Ausführung mit Undo-Punkten, Ergebnisbericht, Scan.</li>
            <li>Freigabe: jede Änderung braucht deine Bestätigung.</li>
            <li>
              KI: {status.ai.mode === 'ki' ? `aktiv (${status.ai.provider}, ${status.ai.model})` : 'nicht konfiguriert – Vorlagen-Engine arbeitet deterministisch'}.
            </li>
            <li>Analyse: Link/Notizen/Screenshots als Inspiration, ohne fremde Assets zu kopieren.</li>
          </ul>
          <p className="muted small">
            Grenzen: Ohne dauerhafte Festplatte kann ein Redeploy die Projektdaten zurücksetzen. Die Analyse liest keine
            Roblox-Spielstände aus – sie arbeitet mit deinen Angaben und erzeugt eine eigene Version.
          </p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------- Analyse -------------------------------- */

function AnalyzePanel({
  analyses,
  busy,
  onAnalyze,
}: {
  analyses: Analysis[];
  busy: boolean;
  onAnalyze: (payload: { url: string; notes: string; screenshots: string[] }) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [shots, setShots] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const accepted: string[] = [];
    for (const file of Array.from(files).slice(0, 4 - shots.length)) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 2_500_000) {
        setHint(`"${file.name}" ist größer als 2,5 MB und wurde übersprungen.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
        reader.readAsDataURL(file);
      });
      accepted.push(dataUrl);
    }
    setShots((current) => [...current, ...accepted].slice(0, 4));
  };

  return (
    <section className="panel">
      <div className="card">
        <h2>Roblox-Spiel analysieren</h2>
        <p className="muted small">
          Link, Beobachtungen und optional Screenshots angeben. Daraus entsteht eine eigene Version mit eigenen Namen,
          eigenen Objekten und eigenem Luau-Code – keine Kopie fremder Skripte oder Assets.
        </p>
        <input
          value={url}
          placeholder="https://www.roblox.com/games/… (optional)"
          onChange={(event) => setUrl(event.target.value)}
        />
        <textarea
          rows={4}
          value={notes}
          placeholder="Was ist sichtbar? z. B. „Pet-Simulator mit drei Inseln, Ei-System, Shop mit Upgrades, Boss alle 10 Minuten“"
          onChange={(event) => setNotes(event.target.value)}
        />
        <div className="row">
          <input type="file" accept="image/*" multiple onChange={(event) => void addFiles(event.target.files)} />
          <button type="button" className="btn ghost" onClick={() => setShots([])} disabled={shots.length === 0}>
            Screenshots entfernen
          </button>
        </div>
        {shots.length > 0 && (
          <div className="shots">
            {shots.map((shot, index) => (
              <img key={index} src={shot} alt={`Screenshot ${index + 1}`} />
            ))}
          </div>
        )}
        {hint && <p className="muted small">{hint}</p>}
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => void onAnalyze({ url, notes, screenshots: shots })}
        >
          {busy ? 'Analysiere …' : 'Analysieren & eigene Version erzeugen'}
        </button>
      </div>

      {analyses.length === 0 && <p className="muted">Noch keine Analysen.</p>}
      {analyses.map((analysis) => (
        <div key={analysis.id} className="card">
          <h3>{analysis.source}</h3>
          <p className="muted small">
            {new Date(analysis.createdAt).toLocaleString('de-DE')} · {analysis.engine === 'ki' ? 'KI' : 'Vorlagen-Engine'} ·{' '}
            {analysis.screenshots} Screenshot(s) · {analysis.actions} Aktionen
          </p>
          <ul className="scan-list">
            {analysis.mechanics.map((mechanic) => (
              <li key={mechanic}>{mechanic}</li>
            ))}
          </ul>
          <p className="muted small">{analysis.summary}</p>
          <p className="muted small">Rechtlich: {analysis.legality}</p>
          <p className="muted small">Grenzen: {analysis.limitations}</p>
        </div>
      ))}
    </section>
  );
}

/* ------------------------------ Projektdaten ---------------------------- */

function DataPanel({
  project,
  onOpenScript,
}: {
  project: Project;
  onOpenScript: (name: string) => Promise<void>;
}) {
  return (
    <section className="panel">
      <div className="grid-2">
        <div className="card">
          <h2>Spielplan</h2>
          {project.summary ? <p>{project.summary}</p> : <p className="muted">Noch kein Spiel generiert.</p>}
          <ul className="scan-list">
            <li>Inseln: {project.counts.islands}</li>
            <li>Pets: {project.counts.pets}</li>
            <li>Gegner: {project.counts.enemies} (davon Bosse: {project.counts.bosses})</li>
            <li>Quests: {project.counts.quests}</li>
            <li>Shop-Artikel: {project.counts.shopItems}</li>
            <li>NPCs: {project.counts.npcs}</li>
          </ul>
          <p className="muted small">
            Gespeichert wird der Blueprint im Projekt. Die Objekte entstehen erst in Studio, wenn Aktionen freigegeben
            und vom Plugin ausgeführt werden.
          </p>
        </div>

        <div className="card">
          <h2>Luau-Skripte</h2>
          {project.scripts.length === 0 && <p className="muted">Noch keine Skripte.</p>}
          <div className="script-list">
            {project.scripts.map((script) => (
              <button key={script.name} type="button" className="script-row" onClick={() => void onOpenScript(script.name)}>
                <span>
                  <strong>{script.name}</strong>
                  <span className="muted small">{script.path}</span>
                </span>
                <span className="muted small">
                  {script.type} · {script.lines} Zeilen
                </span>
              </button>
            ))}
          </div>
          <p className="muted small">
            Skripte werden als echte Skript-Objekte in Studio eingefügt (ReplicatedStorage, ServerScriptService,
            StarterPlayer).
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Einstellungen</h2>
        <p className="muted small">
          Token: <code>{project.token.slice(0, 12)}…</code> · Server-URL für das Plugin:{' '}
          <code>{absoluteUrl('/')}</code>
        </p>
        <p className="muted small">
          Freigabe: Jede Aktion muss bestätigt werden ({project.settings.autoApprove ? 'Automatik aktiv' : 'manuell'}).
        </p>
      </div>
    </section>
  );
}
