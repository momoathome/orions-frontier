# Orion's Frontier

Orion's Frontier ist ein persistentes Idle-Browsergame. Eine Station handelt zunehmend
selbstständig, während der Spieler Prioritäten setzt und die Folgen seiner Entscheidungen in
einer lebenden Welt beobachtet.

Das Repository ist ein npm-Monorepo mit drei Anwendungen und drei gemeinsam genutzten
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
- WebSocket: `ws://localhost:3001`

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
  websocket/     Realtime-Verbindung zum Browser
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
```

Häufige Kommandos:

```bash
npm run typecheck
npm run lint
npm run format
npm run db:migrate
```

Einzelne Workspaces lassen sich direkt ansprechen:

```bash
npm run dev --workspace @orions-frontier/frontend
npm run dev --workspace @orions-frontier/api
npm run dev --workspace @orions-frontier/websocket
```

API und WebSocket benötigen dabei die Werte aus `.env` sowie laufendes PostgreSQL und Redis. Für
die normale Entwicklung ist deshalb Docker Compose der vorgesehene Einstieg.

## Entwicklungsprinzip

Wir erweitern den vorhandenen technischen Vorsprung nicht um weitere klassische
Browsergame-Kataloge. Neue Arbeit muss den Idle-Kern stärken: autonome Entscheidungen, sichtbare
Logistik, wenige verständliche Prioritäten und spürbare Konsequenzen.
