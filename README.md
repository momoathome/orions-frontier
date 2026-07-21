# Orion's Frontier

Orion's Frontier ist ein persistentes Idle-Browsergame. Spieler und wirtschaftliche Bots
erschließen endliche Asteroiden, weisen Miner zu und beobachten ihre vollständigen Rundläufe in
einer lebenden Welt. Bots verwenden dieselben Ressourcen, Bau-Queues, Reisezeiten und
Mining-Regeln wie Spieler.

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
npm run test:behavior
```

Häufige Kommandos:

```bash
npm run typecheck
npm run lint
npm run format
npm run db:migrate
```

Die API führt Migrationen beim Start automatisch aus. `npm run db:migrate` ist nur für eine
manuelle Wiederholung nötig und lädt dabei die lokale `.env`-Datei.

`npm run test:behavior` startet PostgreSQL über Docker und prüft unter anderem konkurrierende
Ressourcenausgaben und Mining-Zugriffe, vollständige Mining-Rundläufe, Recall und Erschöpfung,
das Aufholen nach einem Neustart, Bot-Entscheidungen und -Wachstum sowie die
WebSocket-Authentifizierung. Mit `npm run verify` laufen statische Checks, Build und
Verhaltenschecks gemeinsam.

Einzelne Workspaces lassen sich direkt ansprechen:

```bash
npm run dev --workspace @orions-frontier/frontend
npm run dev --workspace @orions-frontier/api
```

Die API benötigt dabei die Werte aus `.env` sowie laufendes PostgreSQL. Für die normale
Entwicklung ist deshalb Docker Compose der vorgesehene Einstieg. WebSocket und Simulation laufen
direkt im API-Prozess; fällige Vorgänge werden aus PostgreSQL nachgeholt.

## Entwicklungsprinzip

Wir erweitern den vorhandenen technischen Vorsprung nicht um weitere klassische
Browsergame-Kataloge. Neue Arbeit stärkt den spielergesteuerten Idle-Kern: endliche Asteroiden,
sichtbare Mining-Rundläufe, verständliche Leistungswerte und bewusste Investitionsentscheidungen.

Die geplante schrittweise Umstellung ist im [Umsetzungsplan](docs/implementation-plan.md)
festgehalten.
