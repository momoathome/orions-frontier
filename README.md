# Orion's Frontier

Orion's Frontier ist ein persistentes Idle-Browsergame. Spieler und wirtschaftliche Bots
erschließen endliche Asteroiden, weisen Miner zu und beobachten ihre vollständigen Rundläufe in
einer lebenden Sektorwelt. Exploration, weitere Stationen, Kampf, Bergung und Forschung verwenden
dieselben persistenten Reise-, Kosten- und Zeitregeln.

Das Repository ist ein npm-Monorepo mit zwei Anwendungen und zwei gemeinsam genutzten
TypeScript-Paketen.

## Start mit Docker

Voraussetzungen: Docker mit Docker Compose.

```bash
cp .env.example .env
npm run dev
```

Beim ersten Start werden Dependencies, Packages und Container gebaut. Die API führt ausstehende
Datenbankmigrationen selbstständig aus.

- Frontend: <http://localhost:5173>
- API: <http://localhost:3000/api>
- Healthcheck: <http://localhost:3000/api/health>
- WebSocket: `ws://localhost:3000`

Beenden:

```bash
docker compose down
```

Für einen vollständigen lokalen Reset:

```bash
docker compose down -v
```

## Workspace

```text
apps/
  api/           Fastify API, Simulation und PostgreSQL-Zugriff
  frontend/      Vue-Frontend und Pixi-Welt
packages/
  game-config/   Aktuelle Spieldefinitionen und Balancingwerte
  shared/        Gemeinsame Domain- und Transporttypen
```

`package.json` im Root ist der einzige Einstiegspunkt für Installation und übergreifende
Kommandos. Interne Pakete werden über npm Workspaces verknüpft.

## Lokale Werkzeuge

Voraussetzungen: Node.js 24.11 oder neuer und npm 10 oder neuer.

```bash
npm install
npm run check
npm run build
npm run test:unit
npm run test:integration
```

Häufige Kommandos:

```bash
npm run typecheck
npm run lint
npm run format
npm run db:migrate
npm run world:report
```

Die API führt Migrationen beim Start automatisch aus. `npm run db:migrate` ist nur für eine
manuelle Wiederholung nötig und lädt dabei die lokale `.env`-Datei.
`npm run world:report` erzeugt die konfigurierte Startwelt rein im Speicher und gibt Asteroidenzahl
sowie Ressourcenmenge je Sektor aus.

Die noch nicht produktive Migrationshistorie ist zu `0000_initial.sql` zusammengefasst. Nach diesem
Wechsel muss ein vorhandenes lokales Volume einmalig mit `docker compose down -v` entfernt werden;
beim nächsten Start legt die API die aktuelle Entwicklungswelt neu an. Ein Daten-Backfill ist für
diesen Entwicklungsstand nicht vorgesehen.

`npm run test:unit` prüft die reine Spiellogik ohne externe Infrastruktur. Die Tests liegen unter
`apps/api/test/unit`. `npm run test:integration` startet PostgreSQL über Docker und prüft unter
`apps/api/test/integration` unter anderem API-Routen, konkurrierende Ressourcenausgaben und
Mining-Zugriffe, vollständige Mining-Rundläufe, Bots, Exploration, Kolonisation, Kampf, Bergung,
Forschung sowie WebSocket-Authentifizierung. `npm run test:behavior` bleibt als Alias für
die Integrationstests erhalten. Mit `npm run verify` laufen statische Checks, Build und beide
Testgruppen gemeinsam.

Einzelne Workspaces lassen sich direkt ansprechen:

```bash
npm run dev --workspace @orions-frontier/frontend
npm run dev --workspace @orions-frontier/api
```

Die API benötigt dabei die Werte aus `.env` sowie laufendes PostgreSQL. Für die normale
Entwicklung ist deshalb Docker Compose der vorgesehene Einstieg. WebSocket und Simulation laufen
direkt im API-Prozess; fällige Vorgänge werden aus PostgreSQL nachgeholt.

## Beschleunigter Spieltest

Der Playtest läuft ohne HTTP-Server und ohne Echtzeitwarten gegen eine eigene, wegwerfbare
PostgreSQL-Instanz. Er akzeptiert weder die Entwicklungs- noch die normale Testdatenbank.

```bash
npm run playtest -- \
  --seed lokaler-versuch \
  --duration-hours 24 \
  --step-seconds 60 \
  --join-interval-minutes 15 \
  --population-limit 12 \
  --snapshot-interval-minutes 15
```

Ohne Flags gelten genau diese Werte sowie der virtuelle Start
`2030-01-01T00:00:00.000Z`. Mit `--config <datei.json>` kann eine Konfiguration geladen werden;
einzelne CLI-Flags überschreiben die Datei. Profilgewichte lassen sich beispielsweise über
`--profile-technocrat 4` und die entsprechenden Flags für `industrialist`, `pioneer` und `warlord`
setzen.

Der versionierte JSON-Bericht landet standardmäßig unter `artifacts/playtests/`. Harte
Invariantenverletzungen beenden den Lauf mit Fehlerstatus und erzeugen einen gültigen Teilbericht.
Softlock- und Balancehinweise sind dagegen Warnungen: Sie erscheinen mit Belegen im Bericht,
verändern den Exit-Code in Version 1 aber nicht.

Kurze technische Prüfungen:

```bash
npm run test:playtest-bootstrap
npm run test:playtest-population
npm run test:playtest-runner
npm run test:playtest-e2e
```

Reproduzierbare Presets liegen unter `configs/playtest/`. Die technische Entwicklungsbaseline
über drei frische Welten läuft mit:

```bash
npm run playtest:baseline
```

## Entwicklungsprinzip

Wir erweitern den vorhandenen technischen Vorsprung nicht um weitere klassische
Browsergame-Kataloge. Neue Arbeit stärkt den spielergesteuerten Idle-Kern: endliche Asteroiden,
sichtbare Mining-Rundläufe, verständliche Leistungswerte und bewusste Investitionsentscheidungen.

Richtung, Entscheidungen, Zahlenziele und offene Arbeit stehen im
[Design-Kompass](docs/design-compass.md). Die fachlichen Verträge der Systeme:

- [Mining-Rundlauf](docs/mining-loop.md)
- [Stationskapazitäten](docs/station-capacities.md)
- [Weltgenerierung](docs/world-generation.md)
- [Scanner und Sichtbarkeit](docs/scanner-visibility.md)
- [Bot-System](docs/bot-system.md)

Offene Specs für die nächste Mechanik: [Bomber und Vernichtung](docs/station-destruction.md).

Abgeschlossene Pläne und Tickets stehen in der Git-Historie, nicht in `docs/`.
