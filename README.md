# Roblox Studio AI

Beschreibe ein Roblox-Spiel in einem Satz – die Anwendung baut daraus einen vollständigen Spielplan
und echte Studio-Aktionen: Inseln, Gebäude, NPCs, Gegner, Bosse, Pets, Shop, Quests, Levelsystem,
UI und lauffähige Luau-Skripte. Ein eigenes Roblox-Studio-Plugin setzt die freigegebenen Aktionen
direkt in deinem Spiel um.

## Schnellstart (lokal)

```bash
npm install
npm run build
npm start           # http://localhost:3000
```

Ohne weitere Konfiguration arbeitet die App im **Vorlagen-Modus**: Die Generierungs-Engine erzeugt
deterministisch ein vollständiges Spiel aus deinem Prompt. Das ist keine Attrappe – Map, Objekte,
Skripte und Mechaniken werden wirklich erzeugt –, aber die Formulierungen sind regelbasiert und
nicht frei formuliert.

## KI-Modus aktivieren

Ein Sprachmodell wird nur genutzt, wenn ein Schlüssel als Umgebungsvariable gesetzt ist. Schlüssel
bleiben ausschließlich im Server und werden nie an den Browser ausgeliefert.

| Anbieter | Variablen |
| --- | --- |
| OpenAI-kompatibel (OpenAI, OpenRouter, Groq, Together, lokal) | `OPENAI_API_KEY` oder `AI_API_KEY`, optional `AI_BASE_URL`, `AI_MODEL` |
| Anthropic | `ANTHROPIC_API_KEY`, optional `AI_MODEL` |
| Google Gemini | `GEMINI_API_KEY`, optional `AI_MODEL` |

In der App unter **Einstellungen → Umgebungsvariablen** eintragen. Die Statusanzeige oben links
zeigt jederzeit, welcher Modus aktiv ist. Ist ein Schlüssel gesetzt, aber der Anbieter antwortet
nicht, fällt die App sichtbar auf die Vorlagen-Engine zurück und nennt den Grund.

Optionaler Zugangsschutz: `APP_PASSWORD` setzen, dann verlangt die App einen Zugriffscode.

## Roblox-Studio-Plugin installieren

1. In der App: Tab **Studio-Verbindung** → „Plugin herunterladen“.
2. In Roblox Studio: Reiter **Plugins** → **Plugins-Ordner öffnen**.
3. Die Datei `RobloxStudioAI.lua` dort ablegen.
4. Studio neu starten, Werkzeugleiste **Roblox Studio AI** öffnen.
5. Server-URL und Projekt-Token aus der App eintragen, **Verbinden** drücken.

Falls Studio HTTP blockiert: Spiel-Einstellungen → Sicherheit → *Allow HTTP Requests* aktivieren.
Das Plugin arbeitet nur, wenn Studio geöffnet ist; es fragt alle 3 Sekunden nach freigegebenen
Aktionen. Jede Aktion erzeugt vor der Ausführung einen Undo-Punkt (Ctrl+Z in Studio funktioniert).

## Sicherheit und Freigabe

- Nichts wird ohne deine Bestätigung in Studio geändert: Aktionen entstehen als `pending` und
  werden erst nach **Freigeben** an das Plugin ausgeliefert.
- Das Plugin authentifiziert sich mit einem projektgebundenen Token, nicht mit dem App-Passwort.
- Die App führt keine fremden Skripte aus. Luau-Code wird als Text erzeugt und in Studio eingefügt.
- Die Spielanalyse kopiert keine fremden Assets oder geschützten Skripte. Sie leitet aus deinen
  Angaben (Link, Notizen, Screenshots) eine eigene Version mit eigenen Namen und eigenem Code ab.

## Was tatsächlich funktioniert

| Funktion | Status |
| --- | --- |
| Prompt → Spielplan (Inseln, Gebäude, NPCs, Gegner, Bosse, Pets, Shop, Quests, Level) | funktioniert |
| Luau-Skripte erzeugen und in Studio einfügen | funktioniert (echte Skript-Objekte) |
| Studio-Bridge: Poll, Ausführung, Ergebnisbericht, Undo | funktioniert |
| Bestätigung vor Änderungen | funktioniert |
| Chat mit Projektkontext, Änderungen („füge 3 Inseln hinzu“) | funktioniert |
| Bestehendes Projekt scannen und Fehler auswerten | funktioniert (Log-Meldungen + Struktur) |
| Unbegrenzt viele Projekte | funktioniert (JSON-Datei auf dem Server) |
| Roblox-Spielanalyse per Link/Notizen/Screenshots | funktioniert als Inspiration; liest keine Spieldaten aus |
| KI-Formulierungen | nur mit API-Schlüssel, sonst Vorlagen-Engine |

Grenzen, ehrlich benannt:

- Das Plugin kann nur laufen, während Studio offen ist. Es gibt keine Cloud-Verbindung zu Roblox.
- Die App kann keine geschützten Skripte fremder Spiele lesen oder kopieren.
- Ohne dauerhafte Festplatte (Free-Plan) kann ein Redeploy die Projektdatei zurücksetzen.
- Erzeugte Spiele sind ein solides Grundgerüst mit funktionierenden Systemen, kein fertig
  poliertes kommerzielles Spiel. Modelle sind aus Roblox-Primitiven gebaut (keine externen Assets).

## Projektstruktur

```
client/            React-Oberfläche (Dashboard, Chat, Freigabe, Studio-Setup, Analyse)
server/index.js    Express-API inklusive Studio-Bridge
server/blueprint.js  Prompt → Spielplan (Vorlagen-Engine + Validierung von KI-Antworten)
server/compiler.js   Spielplan → Studio-Aktionen + vollständige Luau-Skripte
server/ai.js         Anbieter-Anbindung und Fallback
server/diagnostics.js Fehleranalyse für Studio-Scans
server/store.js      Persistenz (unbegrenzte Projekte)
plugin/            Roblox-Studio-Plugin (Luau)
scripts/smoke.test.mjs End-to-End-Test über die echte API
```

## Tests

```bash
npm test        # End-to-End: Generieren, Freigeben, Plugin-Poll, Report, Scan, Chat
npm run check   # TypeScript + Produktions-Build
```

## API-Überblick

| Route | Zweck |
| --- | --- |
| `GET /api/status` | Betriebsart, KI-Modus, Plugin-Verfügbarkeit |
| `GET/POST /api/projects` | Projekte auflisten / anlegen (mit optionaler Generierung) |
| `GET /api/projects/:id` | Projekt, Chatverlauf, Aktionen, Analysen |
| `POST /api/projects/:id/generate` | Neu generieren aus Prompt |
| `POST /api/projects/:id/chat` | Änderung beauftragen, Fehler besprechen |
| `POST /api/projects/:id/actions/approve` | Freigeben (alle oder einzelne) |
| `POST /api/projects/:id/actions/reject` | Verwerfen |
| `GET /api/projects/:id/scripts/:name` | Luau-Quelltext |
| `POST /api/projects/:id/analyze` | Referenz analysieren |
| `POST /api/plugin/poll` | Plugin holt freigegebene Aktionen (Token) |
| `POST /api/plugin/report` | Plugin meldet Ergebnis |
| `POST /api/plugin/scan` | Plugin sendet Struktur und Log-Meldungen |
| `GET /plugin/RobloxStudioAI.lua` | Plugin-Download mit Server-URL |
