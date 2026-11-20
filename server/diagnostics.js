/**
 * Diagnose: bewertet einen Studio-Scan (Struktur + LogService-Meldungen)
 * und liefert konkrete, umsetzbare Hinweise. Ohne LLM-Key regelbasiert,
 * mit Key zusätzlich durch die KI ergänzt (siehe ai.js).
 */

const ERROR_RULES = [
  {
    match: /infinite yield possible on/i,
    title: 'Warten auf nicht vorhandenes Objekt',
    detail:
      'WaitForChild findet ein Objekt nicht. Prüfe den Namen exakt (Groß-/Kleinschreibung) oder nutze FindFirstChild mit Timeout. Häufig fehlt das Objekt, weil die KI-Aktion noch nicht freigegeben wurde.',
  },
  {
    match: /attempt to index nil with/i,
    title: 'Zugriff auf nicht existierendes Objekt',
    detail:
      'Eine Variable ist nil. Ursache ist meist ein fehlendes Parent-Objekt oder ein Client-Skript, das vor dem Server-Skript startet. Nutze WaitForChild und prüfe, ob das Objekt im Explorer existiert.',
  },
  {
    match: /attempt to call a nil value/i,
    title: 'Funktion existiert nicht',
    detail:
      'Der Funktionsname stimmt nicht oder das Modul wurde nicht korrekt mit require geladen. Prüfe require(Pfad) und ob das ModuleScript wirklich ein return liefert.',
  },
  {
    match: /unable to cast|invalid argument/i,
    title: 'Falscher Datentyp',
    detail:
      'Ein Wert hat den falschen Typ (z. B. String statt Number). Prüfe Vector3/CFrame/Color3-Konstruktoren und wandle Text mit tonumber um.',
  },
  {
    match: /datastore.*(403|401|not allowed|studio access)/i,
    title: 'DataStore im Studio nicht verfügbar',
    detail:
      'DataStore-Zugriffe sind im Studio nur mit aktiviertem "Enable Studio Access to API Services" erlaubt. Die generierten Skripte schalten DataStore im Studio automatisch ab.',
  },
  {
    match: /http.*(403|401|not allowed|trust)/i,
    title: 'HTTP-Anfrage blockiert',
    detail:
      'HttpService ist im Studio deaktiviert. Aktiviere Game Settings → Security → Allow HTTP Requests. Für das Plugin selbst ist HttpService nicht nötig.',
  },
  {
    match: /script timeout|exhausted allowed execution time/i,
    title: 'Endlosschleife ohne yield',
    detail:
      'Füge task.wait() in while-Schleifen ein. Die generierten Services nutzen bereits task.wait(2) in ihren Schleifen.',
  },
  {
    match: /remote event.*not found|RemoteEvent.*nil/i,
    title: 'RemoteEvent fehlt',
    detail:
      'Die RemoteEvents liegen unter ReplicatedStorage.RobloxStudioAI.Remotes. Fehlt der Ordner, wurde die Aktion "ReplicatedStorage-Struktur anlegen" nicht ausgeführt.',
  },
];

const SCRIPT_HINTS = [
  {
    test: (script) => /Script$/.test(script.path) && script.path.includes('ReplicatedStorage'),
    title: 'Script in ReplicatedStorage',
    detail:
      'Ein Script in ReplicatedStorage wird nicht automatisch ausgeführt. Verschiebe es nach ServerScriptService oder starte es über require.',
  },
  {
    test: (script) => script.lines === 0,
    title: 'Leeres Skript',
    detail: 'Ein Skript hat keinen Code. Entweder entfernen oder die zugehörige Aktion neu übertragen.',
  },
  {
    test: (script) => script.disabled === true,
    title: 'Deaktiviertes Skript',
    detail: 'Ein Skript ist auf Disabled gesetzt und läuft nicht. Setze Disabled = false, wenn es aktiv sein soll.',
  },
];

export function analyzeScan(scan) {
  const advice = [];
  const logs = Array.isArray(scan?.logs) ? scan.logs : [];
  const scripts = Array.isArray(scan?.scripts) ? scan.scripts : [];
  const seen = new Set();

  const errorLogs = logs.filter((entry) => String(entry.kind || '').includes('Error'));
  const warningLogs = logs.filter((entry) => String(entry.kind || '').includes('Warning'));

  for (const entry of errorLogs) {
    const message = String(entry.message || '');
    const rule = ERROR_RULES.find((candidate) => candidate.match.test(message));
    const key = rule ? rule.title : `error:${message.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    advice.push({
      severity: 'error',
      title: rule ? rule.title : 'Fehler in der Ausgabe',
      detail: rule ? rule.detail : `Meldung: ${message.slice(0, 240)}`,
      evidence: message.slice(0, 240),
    });
  }

  for (const warning of warningLogs.slice(0, 6)) {
    const message = String(warning.message || '');
    const key = `warn:${message.slice(0, 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    advice.push({
      severity: 'warning',
      title: 'Warnung in der Ausgabe',
      detail: message.slice(0, 240),
      evidence: message.slice(0, 240),
    });
  }

  for (const script of scripts) {
    for (const hint of SCRIPT_HINTS) {
      if (!hint.test(script)) continue;
      const key = `${hint.title}:${script.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      advice.push({
        severity: 'info',
        title: hint.title,
        detail: `${hint.detail} (${script.path})`,
        evidence: script.path,
      });
    }
  }

  const parts = Number(scan?.parts || 0);
  const unanchored = Number(scan?.unanchoredParts || 0);
  if (parts > 0 && unanchored / parts > 0.5) {
    advice.push({
      severity: 'warning',
      title: 'Viele nicht verankerte Teile',
      detail: `${unanchored} von ${parts} Teilen sind nicht verankert. Gebäude können wegfallen; Anchored = true setzen oder "Alle verankern" nutzen.`,
      evidence: `${unanchored}/${parts}`,
    });
  }

  if (scripts.length === 0) {
    advice.push({
      severity: 'info',
      title: 'Keine Skripte gefunden',
      detail: 'Im Platz sind keine Skripte vorhanden. Übertrage zuerst die Skript-Aktionen aus der Web-App.',
      evidence: 'scripts=0',
    });
  }

  const score = Math.max(
    0,
    100 - errorLogs.length * 12 - warningLogs.length * 3 - (unanchored / Math.max(1, parts)) * 20,
  );

  return {
    score: Math.round(score),
    errors: errorLogs.length,
    warnings: warningLogs.length,
    parts,
    models: Number(scan?.models || 0),
    unanchoredParts: unanchored,
    scripts: scripts.length,
    advice: advice.slice(0, 20),
    summary:
      advice.length === 0
        ? 'Keine Probleme in der Studio-Ausgabe gefunden.'
        : `${errorLogs.length} Fehler, ${warningLogs.length} Warnungen und ${advice.length} Hinweise ausgewertet.`,
  };
}

/** Fehler, die typischerweise durch fehlende Freigabe entstehen. */
export function blockedByApproval(scan) {
  const logs = Array.isArray(scan?.logs) ? scan.logs : [];
  return logs.some((entry) => /infinite yield possible on/i.test(String(entry.message || '')));
}
